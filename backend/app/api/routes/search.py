"""Search endpoint: hybrid / vector-only / lexical-only retrieval."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.chunk import Chunk
from app.schemas.search import SearchHit, SearchRequest, SearchResponse
from app.services.retrieval import (
    FusedHit,
    hybrid_search,
    lexical_only_search,
    vector_only_search,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])


async def _hydrate_missing_metadata(
    session: AsyncSession, hits: list[FusedHit]
) -> dict[str, dict[str, Any]]:
    """Look up chunk metadata from SQLite for any hit missing fields.

    The vector store stores canonical metadata, but this adds a safety net in
    case the index has stale rows.
    """
    missing_ids = [
        h.chunk_id
        for h in hits
        if "document_id" not in h.metadata or "ordinal" not in h.metadata
    ]
    if not missing_ids:
        return {}
    result = await session.execute(
        select(
            Chunk.id,
            Chunk.document_id,
            Chunk.ordinal,
            Chunk.page_start,
            Chunk.page_end,
            Chunk.section_title,
            Chunk.text,
        ).where(Chunk.id.in_(missing_ids))
    )
    rows = result.all()
    return {
        row.id: {
            "document_id": row.document_id,
            "ordinal": row.ordinal,
            "page_start": row.page_start,
            "page_end": row.page_end,
            "section_title": row.section_title or "",
            "text": row.text,
        }
        for row in rows
    }


def _hit_to_response(
    hit: FusedHit, fallback: dict[str, Any] | None, *, mode: str
) -> SearchHit | None:
    meta = hit.metadata
    document_id = meta.get("document_id") or (fallback or {}).get("document_id")
    if not document_id:
        return None
    ordinal = meta.get("ordinal")
    if ordinal is None:
        ordinal = (fallback or {}).get("ordinal", 0)
    page_start = meta.get("page_start") or (fallback or {}).get("page_start", 0) or 0
    page_end = meta.get("page_end") or (fallback or {}).get("page_end", 0) or 0
    section_title = meta.get("section_title")
    if section_title in (None, ""):
        section_title = (fallback or {}).get("section_title") or None
    text = hit.text or (fallback or {}).get("text") or ""

    score_vector = hit.vector_score
    score_lexical = hit.lexical_score
    if mode == "vector":
        score_vector = hit.rrf_score if score_vector is None else score_vector
    if mode == "lexical":
        score_lexical = hit.rrf_score if score_lexical is None else score_lexical

    return SearchHit(
        chunk_id=hit.chunk_id,
        document_id=str(document_id),
        ordinal=int(ordinal),
        page_start=int(page_start),
        page_end=int(page_end),
        section_title=section_title if section_title else None,
        text=text,
        score_hybrid=float(hit.rrf_score),
        score_vector=(float(score_vector) if score_vector is not None else None),
        score_lexical=(float(score_lexical) if score_lexical is not None else None),
    )


@router.post("", response_model=SearchResponse)
async def search(
    body: SearchRequest,
    session: AsyncSession = Depends(get_session),
) -> SearchResponse:
    """Run hybrid / vector / lexical retrieval against the ingested corpus."""
    mode = body.mode
    if mode == "vector":
        hits = await vector_only_search(
            body.query, top_k=body.top_k, document_id=body.document_id
        )
    elif mode == "lexical":
        hits = await lexical_only_search(
            body.query, top_k=body.top_k, document_id=body.document_id
        )
    else:
        hits = await hybrid_search(
            body.query, top_k=body.top_k, document_id=body.document_id
        )

    fallback_map = await _hydrate_missing_metadata(session, hits)

    results: list[SearchHit] = []
    for hit in hits:
        fallback = fallback_map.get(hit.chunk_id)
        rendered = _hit_to_response(hit, fallback, mode=mode)
        if rendered is not None:
            results.append(rendered)

    return SearchResponse(query=body.query, mode=mode, results=results)


__all__ = ["router"]
