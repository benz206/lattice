"""Tests for the retrieval fusion math and the hybrid_search integration."""

from __future__ import annotations

import pytest

from app.adapters.embedder import HashEmbedder
from app.db.session import async_session_maker
from app.models.chunk import Chunk
from app.models.document import Document
from app.services.lexical_index import get_lexical_index
from app.services.retrieval import (
    _weighted_rrf,
    hybrid_search,
    reciprocal_rank_fusion,
)
from app.services.vector_store import get_vector_store


def test_reciprocal_rank_fusion_basic_arithmetic() -> None:
    fused = reciprocal_rank_fusion([["a", "b", "c"], ["b", "a", "d"]], k=60)
    # Exact arithmetic check for "a": rank 0 in list 1, rank 1 in list 2.
    expected_a = (1.0 / (60 + 0 + 1)) + (1.0 / (60 + 1 + 1))
    assert fused["a"] == pytest.approx(expected_a)
    # "a" and "b" appear in both lists, so they should beat "c" and "d".
    assert fused["a"] > fused["c"]
    assert fused["a"] > fused["d"]
    assert fused["b"] > fused["c"]
    assert fused["b"] > fused["d"]


def test_weighted_rrf_alpha_one_uses_only_vector() -> None:
    fused = _weighted_rrf(["a", "b"], ["b", "a"], alpha=1.0)
    expected_a = 1.0 * (1.0 / (60 + 0 + 1))
    expected_b = 1.0 * (1.0 / (60 + 1 + 1))
    assert fused["a"] == pytest.approx(expected_a)
    assert fused["b"] == pytest.approx(expected_b)


def test_weighted_rrf_alpha_zero_uses_only_lexical() -> None:
    fused = _weighted_rrf(["a", "b"], ["b", "a"], alpha=0.0)
    # Lexical order is ["b","a"]: b gets rank 0, a gets rank 1.
    expected_b = 1.0 * (1.0 / (60 + 0 + 1))
    expected_a = 1.0 * (1.0 / (60 + 1 + 1))
    assert fused["b"] == pytest.approx(expected_b)
    assert fused["a"] == pytest.approx(expected_a)


def test_reciprocal_rank_fusion_empty_input() -> None:
    assert reciprocal_rank_fusion([]) == {}
    assert reciprocal_rank_fusion([[], []]) == {}


def test_weighted_rrf_empty_input() -> None:
    assert _weighted_rrf([], [], alpha=0.5) == {}


async def _seed_chunks_and_index() -> tuple[str, list[str]]:
    """Insert a doc + 3 chunks, embed them, upsert into vector store, rebuild BM25."""
    embedder = HashEmbedder(dim=256)
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

    embeddings = embedder.embed(texts, kind="passage")
    metadatas = [
        {"document_id": document_id, "ordinal": i, "page_start": 1, "page_end": 1, "section_title": "S"}
        for i in range(len(texts))
    ]
    get_vector_store().upsert(chunk_ids, embeddings, metadatas, texts)
    await get_lexical_index().invalidate()
    return document_id, chunk_ids


@pytest.mark.asyncio
async def test_hybrid_search_returns_results_for_seeded_corpus(reset_db: None) -> None:
    document_id, _chunk_ids = await _seed_chunks_and_index()
    results = await hybrid_search("alpha bravo", top_k=3)
    assert len(results) > 0
    for hit in results:
        assert hit.rrf_score > 0
        assert "document_id" in hit.metadata
        assert hit.metadata["document_id"] == document_id


@pytest.mark.asyncio
async def test_hybrid_search_document_id_filter_returns_empty(reset_db: None) -> None:
    await _seed_chunks_and_index()
    results = await hybrid_search("alpha bravo", top_k=3, document_id="other")
    assert results == []
