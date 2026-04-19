"""Integration tests for the /api/search endpoint."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient


async def _poll_ready(client: AsyncClient, doc_id: str, timeout: float = 5.0) -> dict[str, Any]:
    deadline = asyncio.get_event_loop().time() + timeout
    last: dict[str, Any] = {}
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/documents/{doc_id}/status")
        assert resp.status_code == 200
        last = resp.json()
        if last["status"] in ("ready", "failed"):
            return last
        await asyncio.sleep(0.05)
    return last


async def _upload_and_wait(client: AsyncClient, sample_pdf_path: Path) -> str:
    with sample_pdf_path.open("rb") as fh:
        response = await client.post(
            "/api/documents",
            files={"file": ("sample.pdf", fh, "application/pdf")},
        )
    assert response.status_code == 202, response.text
    doc_id = response.json()["id"]
    status_body = await _poll_ready(client, doc_id, timeout=5.0)
    assert status_body["status"] == "ready", status_body
    return doc_id


def _assert_hit_shape(hit: dict[str, Any]) -> None:
    for key in (
        "chunk_id",
        "document_id",
        "ordinal",
        "page_start",
        "page_end",
        "section_title",
        "text",
        "score_hybrid",
        "score_vector",
        "score_lexical",
    ):
        assert key in hit, f"missing key {key} in hit {hit}"


@pytest.mark.asyncio
async def test_hybrid_search_returns_results(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await _upload_and_wait(client, sample_pdf_path)
        resp = await client.post(
            "/api/search",
            json={"query": "lattice sample", "mode": "hybrid", "top_k": 5},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["query"] == "lattice sample"
        assert body["mode"] == "hybrid"
        assert isinstance(body["results"], list)
        assert len(body["results"]) > 0
        for hit in body["results"]:
            _assert_hit_shape(hit)


@pytest.mark.asyncio
async def test_vector_search_sets_score_vector(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await _upload_and_wait(client, sample_pdf_path)
        resp = await client.post(
            "/api/search",
            json={"query": "lattice sample", "mode": "vector", "top_k": 5},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mode"] == "vector"
        assert len(body["results"]) > 0
        for hit in body["results"]:
            _assert_hit_shape(hit)
            assert hit["score_vector"] is not None


@pytest.mark.asyncio
async def test_lexical_search_sets_score_lexical(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    """Seed a multi-chunk corpus with varied vocab so BM25 IDF is positive."""
    from app.adapters.embedder import get_embedder
    from app.db.session import async_session_maker
    from app.models.chunk import Chunk
    from app.models.document import Document
    from app.services.lexical_index import get_lexical_index
    from app.services.vector_store import get_vector_store

    texts = [
        "photosynthesis converts sunlight into chemical energy via chlorophyll",
        "thermodynamics describes entropy and disorder in physical systems",
        "recursion happens when a function calls itself directly",
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

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/search",
            json={"query": "photosynthesis", "mode": "lexical", "top_k": 5},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mode"] == "lexical"
        assert len(body["results"]) > 0
        for hit in body["results"]:
            _assert_hit_shape(hit)
            assert hit["score_lexical"] is not None


@pytest.mark.asyncio
async def test_search_document_id_filter(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        doc_id = await _upload_and_wait(client, sample_pdf_path)

        resp = await client.post(
            "/api/search",
            json={
                "query": "lattice sample",
                "mode": "hybrid",
                "top_k": 5,
                "document_id": doc_id,
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["results"]) > 0
        for hit in body["results"]:
            assert hit["document_id"] == doc_id

        bogus = await client.post(
            "/api/search",
            json={
                "query": "lattice sample",
                "mode": "hybrid",
                "top_k": 5,
                "document_id": "bogus-doc-id",
            },
        )
        assert bogus.status_code == 200, bogus.text
        assert bogus.json()["results"] == []


@pytest.mark.asyncio
async def test_empty_query_rejected_by_validation(
    app: Any, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/search",
            json={"query": "", "mode": "hybrid", "top_k": 5},
        )
        # ``SearchRequest.query`` has ``min_length=1``.
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_invalid_mode_rejected(app: Any, reset_db: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/search",
            json={"query": "lattice", "mode": "invalid", "top_k": 5},
        )
        assert resp.status_code == 422
