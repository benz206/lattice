"""Tests for the ChromaDB-backed vector store wrapper."""

from __future__ import annotations

import numpy as np
import pytest

from app.adapters.embedder import HashEmbedder
from app.services.vector_store import get_vector_store


def _embed_passages(embedder: HashEmbedder, texts: list[str]) -> np.ndarray:
    return embedder.embed(texts, kind="passage")


@pytest.mark.asyncio
async def test_upsert_count_and_query_returns_top_match(reset_db: None) -> None:
    embedder = HashEmbedder(dim=256)
    vs = get_vector_store()

    chunk_ids = ["c-alpha", "c-charlie", "c-echo"]
    texts = ["alpha bravo", "charlie delta", "echo foxtrot"]
    embeddings = _embed_passages(embedder, texts)
    metadatas = [
        {"document_id": "doc1", "ordinal": 0},
        {"document_id": "doc1", "ordinal": 1},
        {"document_id": "doc2", "ordinal": 0},
    ]
    vs.upsert(chunk_ids, embeddings, metadatas, texts)

    assert vs.count() == 3

    query_vec = embedder.embed(["alpha bravo"], kind="query")[0]
    hits = vs.query(query_vec, top_k=2)
    assert len(hits) <= 2
    assert len(hits) >= 1
    assert hits[0].chunk_id == "c-alpha"
    # Cosine similarity ∈ [-1, 1]; allow tiny float32 rounding slack at the boundary.
    assert -1.0 - 1e-5 <= hits[0].score <= 1.0 + 1e-5


@pytest.mark.asyncio
async def test_query_filters_by_metadata(reset_db: None) -> None:
    embedder = HashEmbedder(dim=256)
    vs = get_vector_store()

    chunk_ids = ["c1", "c2", "c3"]
    texts = ["alpha bravo", "charlie delta", "echo foxtrot"]
    embeddings = _embed_passages(embedder, texts)
    metadatas = [
        {"document_id": "doc1", "ordinal": 0},
        {"document_id": "doc2", "ordinal": 0},
        {"document_id": "doc2", "ordinal": 1},
    ]
    vs.upsert(chunk_ids, embeddings, metadatas, texts)

    query_vec = embedder.embed(["charlie delta"], kind="query")[0]
    hits = vs.query(query_vec, top_k=10, where={"document_id": "doc1"})
    assert all(h.metadata.get("document_id") == "doc1" for h in hits)
    assert {h.chunk_id for h in hits} == {"c1"}


@pytest.mark.asyncio
async def test_delete_document_removes_only_matching(reset_db: None) -> None:
    embedder = HashEmbedder(dim=256)
    vs = get_vector_store()

    chunk_ids = ["c1", "c2", "c3"]
    texts = ["alpha bravo", "charlie delta", "echo foxtrot"]
    embeddings = _embed_passages(embedder, texts)
    metadatas = [
        {"document_id": "doc1", "ordinal": 0},
        {"document_id": "doc2", "ordinal": 0},
        {"document_id": "doc2", "ordinal": 1},
    ]
    vs.upsert(chunk_ids, embeddings, metadatas, texts)
    assert vs.count() == 3

    vs.delete_document("doc2")
    assert vs.count() == 1
    remaining = vs.get(["c1"])
    assert len(remaining) == 1
    assert remaining[0].metadata.get("document_id") == "doc1"


@pytest.mark.asyncio
async def test_delete_chunks_removes_specific_ids(reset_db: None) -> None:
    embedder = HashEmbedder(dim=256)
    vs = get_vector_store()

    chunk_ids = ["c1", "c2", "c3"]
    texts = ["alpha bravo", "charlie delta", "echo foxtrot"]
    embeddings = _embed_passages(embedder, texts)
    metadatas = [
        {"document_id": "doc1", "ordinal": 0},
        {"document_id": "doc1", "ordinal": 1},
        {"document_id": "doc1", "ordinal": 2},
    ]
    vs.upsert(chunk_ids, embeddings, metadatas, texts)
    assert vs.count() == 3

    vs.delete_chunks(["c2"])
    assert vs.count() == 2
    assert vs.get(["c2"]) == []


@pytest.mark.asyncio
async def test_get_returns_text_and_metadata(reset_db: None) -> None:
    embedder = HashEmbedder(dim=256)
    vs = get_vector_store()

    chunk_ids = ["c-alpha"]
    texts = ["alpha bravo"]
    embeddings = _embed_passages(embedder, texts)
    metadatas = [{"document_id": "doc1", "ordinal": 0}]
    vs.upsert(chunk_ids, embeddings, metadatas, texts)

    fetched = vs.get(["c-alpha"])
    assert len(fetched) == 1
    assert fetched[0].chunk_id == "c-alpha"
    assert fetched[0].text == "alpha bravo"
    assert fetched[0].metadata.get("document_id") == "doc1"


@pytest.mark.asyncio
async def test_upsert_empty_input_is_noop(reset_db: None) -> None:
    vs = get_vector_store()
    before = vs.count()
    # Should not raise.
    vs.upsert([], np.zeros((0, 256), dtype=np.float32), [], [])
    assert vs.count() == before


@pytest.mark.asyncio
async def test_upsert_shape_mismatch_raises(reset_db: None) -> None:
    embedder = HashEmbedder(dim=256)
    vs = get_vector_store()
    embeddings = embedder.embed(["alpha", "bravo"], kind="passage")
    with pytest.raises(ValueError):
        vs.upsert(
            ["only-one-id"],
            embeddings,
            [{"document_id": "doc1"}],
            ["alpha"],
        )
