"""Tests for the answering pipeline."""

from __future__ import annotations

import pytest

from app.adapters.embedder import get_embedder
from app.adapters.llm import LlmProtocol, Message, reset_llm_cache
from app.db.session import async_session_maker
from app.models.chunk import Chunk
from app.models.document import Document
from app.services.answering import (
    INSUFFICIENT_ANSWER,
    MAX_CONTEXT_CHARS,
    AnswerResult,
    Citation,
    EvidencePassage,
    answer_query,
    build_prompt,
    estimate_answer_score,
    estimate_confidence,
    normalize_citation_tokens,
    parse_citations,
)
from app.services.lexical_index import get_lexical_index
from app.services.vector_store import get_vector_store


async def _seed_corpus() -> tuple[str, list[str]]:
    """Insert a doc + chunks, embed them, upsert into vector store, invalidate BM25."""
    texts = [
        "alpha bravo retrieval keywords",
        "charlie delta different content",
        "echo foxtrot another distinct chunk",
    ]
    async with async_session_maker() as session:
        document = Document(
            filename="seed.pdf",
            content_type="application/pdf",
            size_bytes=1,
            status="ready",
            storage_path="/tmp/seed.pdf",
        )
        session.add(document)
        await session.flush()
        chunks = [
            Chunk(
                document_id=document.id,
                ordinal=i,
                text=t,
                page_start=1,
                page_end=1,
                char_start=i * 100,
                char_end=(i + 1) * 100,
                section_title="S",
            )
            for i, t in enumerate(texts)
        ]
        session.add_all(chunks)
        await session.commit()
        chunk_ids = [c.id for c in chunks]
        document_id = document.id

    embedder = get_embedder()
    embeddings = embedder.embed(texts, kind="passage")
    metadatas = [
        {
            "document_id": document_id,
            "ordinal": i,
            "page_start": 1,
            "page_end": 1,
            "section_title": "S",
        }
        for i in range(len(texts))
    ]
    get_vector_store().upsert(chunk_ids, embeddings, metadatas, texts)
    await get_lexical_index().invalidate()
    return document_id, chunk_ids


def _make_passage(idx: int, *, text: str = "passage text", chunk_id: str | None = None) -> EvidencePassage:
    return EvidencePassage(
        chunk_id=chunk_id or f"chunk-{idx}",
        document_id="doc-1",
        ordinal=idx,
        page_start=idx + 1,
        page_end=idx + 1,
        section_title="S",
        text=text,
        score=0.5,
    )


@pytest.mark.asyncio
async def test_answer_query_returns_cited_answer(
    reset_db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LATTICE_LLM", "stub")
    reset_llm_cache()
    try:
        await _seed_corpus()
        result = await answer_query("alpha bravo")
        assert isinstance(result, AnswerResult)
        assert result.insufficient is False
        assert result.evidence, "evidence should not be empty"
        assert result.answer
        assert len(result.citations) >= 1
        assert 0.0 < result.confidence <= 1.0
        assert 0.0 < result.answer_score <= 1.0
        assert all(isinstance(c, Citation) for c in result.citations)
        # retrieval_meta has the documented keys.
        for key in ("hit_count", "max_score", "alpha", "top_k", "model"):
            assert key in result.retrieval_meta
    finally:
        reset_llm_cache()


def test_parse_citations_dedupes_and_skips_out_of_range() -> None:
    passages = [_make_passage(i) for i in range(4)]
    answer = "foo [E1] bar [E3] baz [E1] qux [E99]"
    cites = parse_citations(answer, passages)
    assert len(cites) == 2
    assert cites[0].chunk_id == "chunk-0"  # [E1] -> passages[0]
    assert cites[1].chunk_id == "chunk-2"  # [E3] -> passages[2]


def test_parse_citations_accepts_invisible_unicode_marks() -> None:
    passages = [_make_passage(i) for i in range(5)]
    answer = "foo [\u200bE4\u200b] bar [E5]"
    cites = parse_citations(answer, passages)
    assert [c.chunk_id for c in cites] == ["chunk-3", "chunk-4"]
    assert normalize_citation_tokens(answer) == "foo [E4] bar [E5]"


@pytest.mark.asyncio
async def test_answer_query_insufficient_when_no_hits(
    reset_db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LATTICE_LLM", "stub")
    reset_llm_cache()
    try:
        await _seed_corpus()
        # Force empty hits via a non-existent document filter.
        result = await answer_query("alpha bravo", document_id="nonexistent")
        assert result.insufficient is True
        assert result.answer == INSUFFICIENT_ANSWER
        assert result.citations == []
        assert result.evidence == []
        assert result.confidence == 0.0
        assert result.answer_score == 0.0
    finally:
        reset_llm_cache()


class _AlwaysInsufficientLlm:
    """Test double whose generate always returns the insufficient marker."""

    @property
    def name(self) -> str:
        return "always-insufficient"

    async def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        stop: list[str] | None = None,
    ) -> str:
        del messages, max_tokens, temperature, stop
        return "INSUFFICIENT_EVIDENCE"


@pytest.mark.asyncio
async def test_answer_query_respects_insufficient_marker(reset_db: None) -> None:
    await _seed_corpus()
    fake: LlmProtocol = _AlwaysInsufficientLlm()
    result = await answer_query("alpha bravo", llm=fake)
    assert result.insufficient is True
    assert result.answer == INSUFFICIENT_ANSWER
    assert result.citations == []
    # Evidence is still populated since retrieval found hits.
    assert result.evidence


def test_build_prompt_caps_context_chars() -> None:
    big = "x" * 4000
    passages = [
        _make_passage(0, text=big, chunk_id="c0"),
        _make_passage(1, text=big, chunk_id="c1"),
        _make_passage(2, text=big, chunk_id="c2"),
    ]
    # Pre-cap with the same helper used by answer_query.
    from app.services.answering import _cap_passages

    capped = _cap_passages(passages, MAX_CONTEXT_CHARS)
    total_text = sum(len(p.text) for p in capped)
    assert total_text <= MAX_CONTEXT_CHARS

    messages = build_prompt("question?", capped)
    user = next(m for m in messages if m["role"] == "user")
    # User content includes headers + question + footer; allow modest overhead.
    overhead_budget = 800
    assert len(user["content"]) <= MAX_CONTEXT_CHARS + overhead_budget


def test_confidence_normalizes_rrf_scores() -> None:
    passages = [_make_passage(0), _make_passage(1), _make_passage(2)]
    passages[0].score = 1.0 / 61.0
    assert estimate_confidence(passages, 2) == pytest.approx(1.0)
    assert estimate_confidence(passages, 0) < estimate_confidence(passages, 1)


def test_answer_score_accounts_for_insufficient_answers() -> None:
    assert (
        estimate_answer_score(
            answer="Insufficient evidence to answer.",
            confidence=0.8,
            citation_count=2,
            insufficient=True,
        )
        == 0.0
    )
    assert (
        estimate_answer_score(
            answer="Grounded answer with support. [E1]",
            confidence=0.8,
            citation_count=1,
            insufficient=False,
        )
        > 0.0
    )
