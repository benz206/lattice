"""Document upload, retrieval, and lifecycle endpoints."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_session
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.page import Page
from app.schemas.chunk import ChunkOut
from app.schemas.document import DocumentDetail, DocumentOut, DocumentStatus
from app.schemas.page import PageFull, PageOut
from app.services.ingestion import queue_ingest
from app.services.lexical_index import get_lexical_index
from app.services.vector_store import get_vector_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["documents"])

_CHUNK_SIZE = 1024 * 1024
_PREVIEW_CHARS = 240


def _is_pdf(file: UploadFile) -> bool:
    ctype = (file.content_type or "").lower()
    if ctype.startswith("application/pdf"):
        return True
    name = (file.filename or "").lower()
    return name.endswith(".pdf")


async def _persist_upload(file: UploadFile, destination: Path, max_bytes: int) -> int:
    """Stream ``file`` into ``destination``; return size or -1 if oversize."""
    total = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as out:
        while True:
            chunk = await file.read(_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                out.close()
                try:
                    destination.unlink(missing_ok=True)
                except OSError:
                    pass
                return -1
            out.write(chunk)
    return total


@router.post(
    "",
    response_model=DocumentOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    """Accept a PDF upload, persist it, and schedule background ingestion."""
    if not _is_pdf(file):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF uploads are accepted.",
        )

    max_bytes = settings.max_upload_mb * 1024 * 1024
    doc_id = str(uuid.uuid4())
    storage_path = Path(settings.upload_dir) / f"{doc_id}.pdf"

    size = await _persist_upload(file, storage_path, max_bytes)
    if size < 0:
        logger.warning(
            "oversize upload rejected filename=%s max_mb=%s",
            file.filename,
            settings.max_upload_mb,
        )
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds max upload size of {settings.max_upload_mb} MB.",
        )

    document = Document(
        id=doc_id,
        filename=file.filename or f"{doc_id}.pdf",
        content_type=file.content_type or "application/pdf",
        size_bytes=size,
        status="pending",
        storage_path=str(storage_path),
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)

    background_tasks.add_task(queue_ingest, doc_id)
    return DocumentOut.model_validate(document)


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    """Return up to 100 documents, newest first."""
    result = await session.execute(
        select(Document).order_by(Document.created_at.desc()).limit(100)
    )
    docs = result.scalars().all()
    return [DocumentOut.model_validate(d) for d in docs]


@router.get("/{document_id}", response_model=DocumentDetail)
async def get_document(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> DocumentDetail:
    """Return document metadata and per-page previews."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    result = await session.execute(
        select(Page)
        .where(Page.document_id == document_id)
        .order_by(Page.page_number.asc())
    )
    pages = result.scalars().all()
    page_previews = [
        PageOut(
            page_number=p.page_number,
            char_count=p.char_count,
            preview=p.text[:_PREVIEW_CHARS],
        )
        for p in pages
    ]
    num_chunks_result = await session.execute(
        select(func.count())
        .select_from(Chunk)
        .where(Chunk.document_id == document_id)
    )
    num_chunks = int(num_chunks_result.scalar_one() or 0)

    summary = DocumentOut.model_validate(document).model_dump()
    return DocumentDetail(**summary, pages=page_previews, num_chunks=num_chunks)


@router.get("/{document_id}/status", response_model=DocumentStatus)
async def get_document_status(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> DocumentStatus:
    """Lightweight polling endpoint for ingestion progress."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return DocumentStatus(
        id=document.id,
        status=document.status,
        num_pages=document.num_pages,
        error=document.error,
    )


@router.get("/{document_id}/pages/{page_number}", response_model=PageFull)
async def get_document_page(
    document_id: str,
    page_number: int,
    session: AsyncSession = Depends(get_session),
) -> PageFull:
    """Return full text for a single page of a document."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    result = await session.execute(
        select(Page).where(
            Page.document_id == document_id, Page.page_number == page_number
        )
    )
    page = result.scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=404, detail="Page not found.")

    return PageFull(
        page_number=page.page_number,
        char_count=page.char_count,
        text=page.text,
    )


@router.get("/{document_id}/chunks", response_model=list[ChunkOut])
async def list_document_chunks(
    document_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[ChunkOut]:
    """Return chunks for a document ordered by ordinal, with pagination."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    result = await session.execute(
        select(Chunk)
        .where(Chunk.document_id == document_id)
        .order_by(Chunk.ordinal.asc())
        .offset(offset)
        .limit(limit)
    )
    chunks = result.scalars().all()
    return [ChunkOut.model_validate(c) for c in chunks]


@router.get("/{document_id}/chunks/{ordinal}", response_model=ChunkOut)
async def get_document_chunk(
    document_id: str,
    ordinal: int,
    session: AsyncSession = Depends(get_session),
) -> ChunkOut:
    """Return a single chunk by ordinal."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    result = await session.execute(
        select(Chunk).where(
            Chunk.document_id == document_id, Chunk.ordinal == ordinal
        )
    )
    chunk = result.scalar_one_or_none()
    if chunk is None:
        raise HTTPException(status_code=404, detail="Chunk not found.")
    return ChunkOut.model_validate(chunk)


@router.get("/{document_id}/map")
async def get_document_map(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Return the document outline computed during ingestion."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not document.document_map:
        raise HTTPException(status_code=404, detail="Document map not available.")
    try:
        parsed = json.loads(document.document_map)
    except ValueError as exc:
        raise HTTPException(
            status_code=500, detail="Stored document map is invalid."
        ) from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=500, detail="Stored document map is invalid.")
    return parsed


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a document row, cascade its pages/chunks, and remove its file."""
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    storage_path = document.storage_path
    await session.delete(document)
    await session.commit()

    # Remove associated vectors and invalidate the BM25 index.
    try:
        get_vector_store().delete_document(document_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "vector_store delete failed document_id=%s error=%s", document_id, exc
        )
    try:
        await get_lexical_index().invalidate()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "lexical invalidate failed document_id=%s error=%s", document_id, exc
        )

    try:
        path = Path(storage_path)
        if storage_path and path.exists():
            path.unlink()
    except OSError as exc:
        logger.warning(
            "failed to remove storage file document_id=%s path=%s error=%s",
            document_id,
            storage_path,
            exc,
        )


__all__ = ["router"]
