"""Integration tests for the documents API."""

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


@pytest.mark.asyncio
async def test_upload_and_retrieve_document(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with sample_pdf_path.open("rb") as fh:
            response = await client.post(
                "/api/documents",
                files={"file": ("sample.pdf", fh, "application/pdf")},
            )
        assert response.status_code == 202, response.text
        body = response.json()
        for key in (
            "id",
            "filename",
            "content_type",
            "size_bytes",
            "status",
            "created_at",
            "updated_at",
        ):
            assert key in body
        assert body["filename"] == "sample.pdf"
        assert body["status"] in ("pending", "processing", "ready")
        doc_id = body["id"]

        status_body = await _poll_ready(client, doc_id, timeout=5.0)
        assert status_body["status"] == "ready", status_body
        assert status_body["num_pages"] == 3
        assert status_body["error"] is None

        listing = await client.get("/api/documents")
        assert listing.status_code == 200
        ids = [d["id"] for d in listing.json()]
        assert doc_id in ids

        detail = await client.get(f"/api/documents/{doc_id}")
        assert detail.status_code == 200
        detail_body = detail.json()
        assert detail_body["num_pages"] == 3
        assert len(detail_body["pages"]) == 3
        assert all("preview" in p for p in detail_body["pages"])
        assert detail_body["pages"][0]["page_number"] == 1

        page_two = await client.get(f"/api/documents/{doc_id}/pages/2")
        assert page_two.status_code == 200
        page_body = page_two.json()
        assert page_body["page_number"] == 2
        assert page_body["char_count"] > 0
        assert "two" in page_body["text"].lower()

        missing_page = await client.get(f"/api/documents/{doc_id}/pages/99")
        assert missing_page.status_code == 404


@pytest.mark.asyncio
async def test_delete_document_removes_file(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with sample_pdf_path.open("rb") as fh:
            response = await client.post(
                "/api/documents",
                files={"file": ("sample.pdf", fh, "application/pdf")},
            )
        assert response.status_code == 202
        doc_id = response.json()["id"]
        await _poll_ready(client, doc_id, timeout=5.0)

        from app.core.config import settings

        storage_path = Path(settings.upload_dir) / f"{doc_id}.pdf"
        assert storage_path.exists()

        delete_resp = await client.delete(f"/api/documents/{doc_id}")
        assert delete_resp.status_code == 204

        assert not storage_path.exists()

        missing = await client.get(f"/api/documents/{doc_id}")
        assert missing.status_code == 404


@pytest.mark.asyncio
async def test_reject_non_pdf(app: Any, reset_db: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/documents",
            files={"file": ("notes.txt", b"plain text file", "text/plain")},
        )
        assert response.status_code in (400, 415)


@pytest.mark.asyncio
async def test_reject_oversize_upload(
    app: Any, sample_pdf_path: Path, reset_db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "max_upload_mb", 0)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with sample_pdf_path.open("rb") as fh:
            response = await client.post(
                "/api/documents",
                files={"file": ("sample.pdf", fh, "application/pdf")},
            )
        assert response.status_code == 413


@pytest.mark.asyncio
async def test_get_missing_document_returns_404(app: Any, reset_db: None) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/documents/does-not-exist")
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_chunks_and_document_map_endpoints(
    app: Any, sample_pdf_path: Path, reset_db: None
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        with sample_pdf_path.open("rb") as fh:
            response = await client.post(
                "/api/documents",
                files={"file": ("sample.pdf", fh, "application/pdf")},
            )
        assert response.status_code == 202, response.text
        doc_id = response.json()["id"]

        status_body = await _poll_ready(client, doc_id, timeout=5.0)
        assert status_body["status"] == "ready", status_body

        detail = await client.get(f"/api/documents/{doc_id}")
        assert detail.status_code == 200
        assert detail.json().get("num_chunks", 0) >= 1

        chunks_resp = await client.get(f"/api/documents/{doc_id}/chunks")
        assert chunks_resp.status_code == 200
        chunks = chunks_resp.json()
        assert isinstance(chunks, list)
        assert len(chunks) >= 1
        first = chunks[0]
        for key in (
            "id",
            "ordinal",
            "text",
            "page_start",
            "page_end",
            "char_start",
            "char_end",
            "section_title",
            "summary",
            "keywords",
        ):
            assert key in first
        assert first["ordinal"] == 0
        assert isinstance(first["keywords"], list)

        one_chunk = await client.get(f"/api/documents/{doc_id}/chunks/0")
        assert one_chunk.status_code == 200
        assert one_chunk.json()["ordinal"] == 0

        missing_chunk = await client.get(f"/api/documents/{doc_id}/chunks/9999")
        assert missing_chunk.status_code == 404

        map_resp = await client.get(f"/api/documents/{doc_id}/map")
        assert map_resp.status_code == 200
        body = map_resp.json()
        assert "sections" in body
        assert isinstance(body["sections"], list)
        assert body["num_chunks"] == len(chunks)
