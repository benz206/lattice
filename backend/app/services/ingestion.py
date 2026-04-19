"""Document ingestion pipeline: parse PDF, persist pages and chunks, build map."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.embedder import get_embedder
from app.db.session import async_session_maker
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.page import Page
from app.services.chunk_enrich import extract_keywords, summarize_chunk
from app.services.chunker import chunk_document
from app.services.document_map import build_document_map
from app.services.lexical_index import get_lexical_index
from app.services.pdf_parser import PageText, extract_metadata, extract_pages
from app.services.vector_store import get_vector_store

logger = logging.getLogger(__name__)


def _build_chunk_metadata(document_id: str, chunk: Chunk) -> dict[str, Any]:
    return {
        "document_id": document_id,
        "ordinal": chunk.ordinal,
        "page_start": chunk.page_start,
        "page_end": chunk.page_end,
        "section_title": chunk.section_title or "",
    }


def _char_stats(texts: list[str]) -> tuple[float, int]:
    if not texts:
        return 0.0, 0
    lengths = [len(text) for text in texts]
    return (sum(lengths) / len(lengths), max(lengths))


async def ingest_document(session: AsyncSession, document_id: str) -> None:
    """Parse the PDF for ``document_id``, persist pages+chunks, store document map.

    Progresses the document through ``processing`` → ``ready`` (or ``failed``).
    Also embeds the chunks, upserts them into the vector store, and invalidates
    the BM25 index so subsequent queries rebuild from SQLite.
    """
    document = await session.get(Document, document_id)
    if document is None:
        raise ValueError(f"Document {document_id!r} not found")

    document.status = "processing"
    document.error = None
    await session.commit()

    upserted_chunk_ids: list[str] = []
    vector_store = get_vector_store()

    try:
        logger.info("ingest start document_id=%s path=%s", document_id, document.storage_path)
        pages = extract_pages(document.storage_path)
        metadata = extract_metadata(document.storage_path)
        total_page_chars = sum(page.char_count for page in pages)
        logger.info(
            "ingest parsed document_id=%s num_pages=%d total_page_chars=%d",
            document_id,
            len(pages),
            total_page_chars,
        )

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
        await session.flush()

        page_inputs = [
            PageText(page_number=p.page_number, text=p.text, char_count=p.char_count)
            for p in pages
        ]
        chunks = chunk_document(page_inputs)
        avg_chunk_chars, max_chunk_chars = _char_stats([chunk.text for chunk in chunks])
        logger.info(
            "ingest chunked document_id=%s num_chunks=%d avg_chunk_chars=%.1f max_chunk_chars=%d",
            document_id,
            len(chunks),
            avg_chunk_chars,
            max_chunk_chars,
        )

        chunk_rows = [
            Chunk(
                document_id=document_id,
                ordinal=c.ordinal,
                text=c.text,
                page_start=c.page_start,
                page_end=c.page_end,
                char_start=c.char_start,
                char_end=c.char_end,
                section_title=c.section_title,
                overlap_prefix_len=c.overlap_prefix_len,
                summary=summarize_chunk(c.text[c.overlap_prefix_len :]),
                keywords=json.dumps(
                    extract_keywords(c.text[c.overlap_prefix_len :])
                ),
            )
            for c in chunks
        ]
        session.add_all(chunk_rows)
        await session.flush()

        document.document_map = json.dumps(build_document_map(chunks))

        # Embed + upsert into the vector store.
        if chunk_rows:
            embedder = get_embedder()
            logger.info(
                "ingest embedding document_id=%s embedder=%s chunk_count=%d",
                document_id,
                embedder.name,
                len(chunk_rows),
            )
            embeddings = embedder.embed(
                [c.text for c in chunk_rows], kind="passage"
            )
            chunk_ids = [c.id for c in chunk_rows]
            metadatas = [_build_chunk_metadata(document_id, c) for c in chunk_rows]
            documents_text = [c.text for c in chunk_rows]
            vector_store.upsert(
                chunk_ids=chunk_ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=documents_text,
            )
            upserted_chunk_ids = list(chunk_ids)

            for row in chunk_rows:
                row.embedding_id = row.id

        # Invalidate BM25 so it rebuilds with the new chunks on next query.
        await get_lexical_index().invalidate()

        document.status = "ready"
        document.error = None
        await session.commit()
        logger.info(
            "ingest complete document_id=%s num_pages=%s num_chunks=%s",
            document_id,
            document.num_pages,
            len(chunks),
        )
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        logger.error("ingest failed document_id=%s error=%s", document_id, exc)
        # Best-effort cleanup of any vectors already inserted for this doc.
        if upserted_chunk_ids:
            try:
                vector_store.delete_chunks(upserted_chunk_ids)
            except Exception as cleanup_exc:  # noqa: BLE001
                logger.warning(
                    "vector cleanup failed document_id=%s error=%s",
                    document_id,
                    cleanup_exc,
                )
        try:
            vector_store.delete_document(document_id)
        except Exception:  # noqa: BLE001
            pass
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


# Silence unused-import linter without changing import behaviour.
_ = select

__all__ = ["ingest_document", "queue_ingest"]
