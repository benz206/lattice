"""Document upload, retrieval, and lifecycle endpoints."""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_session
from app.models.document import Document
from app.models.page import Page
from app.schemas.document import DocumentDetail, DocumentOut, DocumentStatus
from app.schemas.page import PageFull, PageOut
from app.services.ingestion import queue_ingest

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
    summary = DocumentOut.model_validate(document).model_dump()
    return DocumentDetail(**summary, pages=page_previews)


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

    try:
        if storage_path and os.path.exists(storage_path):
            os.remove(storage_path)
    except OSError as exc:
        logger.warning(
            "failed to remove storage file document_id=%s path=%s error=%s",
            document_id,
            storage_path,
            exc,
        )


__all__ = ["router"]
