"""Document ingestion pipeline: parse PDF, persist pages, update status."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_maker
from app.models.document import Document
from app.models.page import Page
from app.services.pdf_parser import extract_metadata, extract_pages

logger = logging.getLogger(__name__)


async def ingest_document(session: AsyncSession, document_id: str) -> None:
    """Parse the PDF for ``document_id`` and persist its pages.

    Progresses the document through ``processing`` → ``ready`` (or ``failed``).
    """
    document = await session.get(Document, document_id)
    if document is None:
        raise ValueError(f"Document {document_id!r} not found")

    document.status = "processing"
    document.error = None
    await session.commit()

    try:
        logger.info("ingest start document_id=%s path=%s", document_id, document.storage_path)
        pages = extract_pages(document.storage_path)
        metadata = extract_metadata(document.storage_path)

        session.add_all(
            [
                Page(
                    document_id=document_id,
                    page_number=p.page_number,
                    text=p.text,
                    char_count=p.char_count,
                )
                for p in pages
            ]
        )
        document.num_pages = int(metadata.get("num_pages", len(pages)))
        document.status = "ready"
        document.error = None
        await session.commit()
        logger.info(
            "ingest complete document_id=%s num_pages=%s",
            document_id,
            document.num_pages,
        )
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        logger.error("ingest failed document_id=%s error=%s", document_id, exc)
        failed = await session.get(Document, document_id)
        if failed is not None:
            failed.status = "failed"
            failed.error = str(exc)
            await session.commit()
        raise


async def queue_ingest(document_id: str) -> None:
    """BackgroundTasks-friendly wrapper that opens its own session."""
    async with async_session_maker() as session:
        try:
            await ingest_document(session, document_id)
        except Exception:  # noqa: BLE001
            # Already logged and persisted inside ingest_document.
            return


__all__ = ["ingest_document", "queue_ingest"]
