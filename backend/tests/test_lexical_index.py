"""Tests for the BM25 lexical index."""

from __future__ import annotations

import pytest

from app.db.session import async_session_maker
from app.models.chunk import Chunk
from app.models.document import Document
from app.services.lexical_index import _tokenize, get_lexical_index


async def _seed_chunks() -> tuple[str, list[str]]:
    """Insert one document and four distinctive chunks. Returns (doc_id, chunk_ids)."""
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
                ordinal=0,
                text="Photosynthesis chlorophyll converts sunlight into chemical energy.",
                page_start=1,
                page_end=1,
                char_start=0,
                char_end=60,
                section_title="Bio",
            ),
            Chunk(
                document_id=document.id,
                ordinal=1,
                text="Thermodynamics entropy describes disorder in physical systems.",
                page_start=1,
                page_end=1,
                char_start=60,
                char_end=120,
                section_title="Physics",
            ),
            Chunk(
                document_id=document.id,
                ordinal=2,
                text="Recursion happens when a function calls itself directly.",
                page_start=2,
                page_end=2,
                char_start=0,
                char_end=55,
                section_title="CS",
            ),
            Chunk(
                document_id=document.id,
                ordinal=3,
                text="Mitochondria generate adenosine triphosphate via oxidative metabolism.",
                page_start=2,
                page_end=2,
                char_start=55,
                char_end=120,
                section_title="Bio",
            ),
        ]
        session.add_all(chunks)
        await session.commit()
        return document.id, [c.id for c in chunks]


@pytest.mark.asyncio
async def test_rebuild_reflects_corpus_size(reset_db: None) -> None:
    await _seed_chunks()
    index = get_lexical_index()
    await index.rebuild()
    assert index.size == 4


@pytest.mark.asyncio
async def test_query_returns_matching_chunk_first(reset_db: None) -> None:
    _, chunk_ids = await _seed_chunks()
    index = get_lexical_index()
    await index.rebuild()
    hits = await index.query("photosynthesis", top_k=2)
    assert len(hits) >= 1
    assert hits[0].chunk_id == chunk_ids[0]
    assert hits[0].score > 0


@pytest.mark.asyncio
async def test_query_unknown_term_returns_empty(reset_db: None) -> None:
    await _seed_chunks()
    index = get_lexical_index()
    await index.rebuild()
    hits = await index.query("nonexistentterm12345", top_k=5)
    assert hits == []


@pytest.mark.asyncio
async def test_query_document_id_filter(reset_db: None) -> None:
    await _seed_chunks()
    index = get_lexical_index()
    await index.rebuild()
    hits = await index.query("photosynthesis", top_k=5, document_id="other-doc-id")
    assert hits == []


@pytest.mark.asyncio
async def test_invalidate_triggers_rebuild_on_next_query(reset_db: None) -> None:
    _, chunk_ids = await _seed_chunks()
    index = get_lexical_index()
    await index.rebuild()
    assert index.size == 4

    await index.invalidate()
    hits = await index.query("photosynthesis", top_k=2)
    assert len(hits) >= 1
    assert hits[0].chunk_id == chunk_ids[0]


def test_tokenize_drops_stopwords_and_short_tokens() -> None:
    tokens = _tokenize("The cat and a dog ran into the very big house.")
    # ``the``, ``and``, ``into``, ``very`` are stopwords; ``a`` is len<2.
    assert "the" not in tokens
    assert "and" not in tokens
    assert "into" not in tokens
    assert "very" not in tokens
    assert "a" not in tokens
    # Substantive terms remain (lowercased).
    assert "cat" in tokens
    assert "dog" in tokens
    assert "ran" in tokens
    assert "big" in tokens
    assert "house" in tokens
