"""Integration tests for the /api/answer endpoint."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
def _force_stub_llm(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from app.adapters.llm import reset_llm_cache

    monkeypatch.setenv("LATTICE_LLM", "stub")
    reset_llm_cache()
    try:
        yield
    finally:
        reset_llm_cache()


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


def _assert_answer_shape(body: dict[str, Any]) -> None:
    for key in (
        "query",
        "answer",
        "citations",
        "evidence",
        "insufficient",
        "confidence",
        "answer_score",
        "retrieval_meta",
    ):
        assert key in body, f"missing key {key} in answer body"
    assert isinstance(body["citations"], list)
    assert isinstance(body["evidence"], list)
    assert isinstance(body["retrieval_meta"], dict)


@pytest.mark.asyncio
async def test_answer_endpoint_returns_grounded_response(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await _upload_and_wait(client, sample_pdf_path)
        resp = await client.post(
            "/api/answer",
            json={"query": "lattice sample", "top_k": 5},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        _assert_answer_shape(body)
        assert body["query"] == "lattice sample"
        assert body["insufficient"] is False
        assert body["evidence"], "evidence should be populated"
        assert body["answer"]


@pytest.mark.asyncio
async def test_answer_endpoint_with_document_id_filter(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        doc_id = await _upload_and_wait(client, sample_pdf_path)

        good = await client.post(
            "/api/answer",
            json={"query": "lattice sample", "top_k": 5, "document_id": doc_id},
        )
        assert good.status_code == 200, good.text
        good_body = good.json()
        _assert_answer_shape(good_body)
        assert good_body["insufficient"] is False
        assert good_body["evidence"]
        for ev in good_body["evidence"]:
            assert ev["document_id"] == doc_id

        bogus = await client.post(
            "/api/answer",
            json={"query": "lattice sample", "top_k": 5, "document_id": "bogus-doc"},
        )
        assert bogus.status_code == 200, bogus.text
        bogus_body = bogus.json()
        _assert_answer_shape(bogus_body)
        assert bogus_body["insufficient"] is True
        assert bogus_body["citations"] == []
        assert bogus_body["evidence"] == []


@pytest.mark.asyncio
async def test_answer_endpoint_rejects_empty_query(app: Any, reset_db: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/answer", json={"query": "", "top_k": 5})
        assert resp.status_code == 422
