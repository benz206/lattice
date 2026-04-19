"""Hybrid retrieval: vector + lexical merged via reciprocal rank fusion."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.adapters.embedder import get_embedder
from app.services.lexical_index import LexicalHit, get_lexical_index
from app.services.vector_store import VectorHit, get_vector_store

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FusedHit:
    """A single merged retrieval result with per-retriever debug scores."""

    chunk_id: str
    rrf_score: float
    lexical_score: float | None
    vector_score: float | None
    metadata: dict[str, Any]
    text: str


def reciprocal_rank_fusion(
    rankings: list[list[str]], *, k: int = 60
) -> dict[str, float]:
    """Standard Reciprocal Rank Fusion.

    ``rankings`` is a list of ranked lists (highest score first). Returns a
    dict of ``chunk_id -> fused_score``.
    """
    fused: dict[str, float] = {}
    for ranking in rankings:
        for rank, chunk_id in enumerate(ranking):
            fused[chunk_id] = fused.get(chunk_id, 0.0) + 1.0 / (k + rank + 1)
    return fused


def _weighted_rrf(
    vector_ids: list[str],
    lexical_ids: list[str],
    *,
    alpha: float,
    k: int = 60,
) -> dict[str, float]:
    """RRF with an ``alpha`` weight on the vector list (``1-alpha`` on lexical)."""
    fused: dict[str, float] = {}
    for rank, chunk_id in enumerate(vector_ids):
        fused[chunk_id] = fused.get(chunk_id, 0.0) + alpha * (1.0 / (k + rank + 1))
    for rank, chunk_id in enumerate(lexical_ids):
        fused[chunk_id] = fused.get(chunk_id, 0.0) + (1.0 - alpha) * (1.0 / (k + rank + 1))
    return fused


def _build_where(document_id: str | None) -> dict[str, Any] | None:
    if document_id is None:
        return None
    return {"document_id": document_id}


async def hybrid_search(
    query: str,
    *,
    top_k: int = 20,
    per_retriever_k: int = 40,
    document_id: str | None = None,
    alpha: float = 0.5,
) -> list[FusedHit]:
    """Retrieve chunks via both vector and BM25 and fuse via RRF."""
    if not query or not query.strip():
        return []

    embedder = get_embedder()
    vector_store = get_vector_store()
    lexical_index = get_lexical_index()

    query_embedding = embedder.embed([query], kind="query")[0]
    vector_hits: list[VectorHit] = vector_store.query(
        query_embedding,
        top_k=per_retriever_k,
        where=_build_where(document_id),
    )
    lexical_hits: list[LexicalHit] = await lexical_index.query(
        query,
        top_k=per_retriever_k,
        document_id=document_id,
    )

    vector_ids = [h.chunk_id for h in vector_hits]
    lexical_ids = [h.chunk_id for h in lexical_hits]

    fused = _weighted_rrf(vector_ids, lexical_ids, alpha=alpha)

    vector_by_id = {h.chunk_id: h for h in vector_hits}
    lexical_by_id = {h.chunk_id: h for h in lexical_hits}

    ordered = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)
    ordered = ordered[: max(1, int(top_k))]

    results: list[FusedHit] = []
    for chunk_id, score in ordered:
        v = vector_by_id.get(chunk_id)
        lex = lexical_by_id.get(chunk_id)
        # Prefer metadata/text from whichever retriever has richer fields.
        metadata: dict[str, Any] = {}
        text: str = ""
        if v is not None:
            metadata = dict(v.metadata)
            text = v.text
        if lex is not None:
            # Fill any missing fields from the lexical metadata.
            for key, value in lex.metadata.items():
                metadata.setdefault(key, value)
            if not text:
                text = lex.text
        results.append(
            FusedHit(
                chunk_id=chunk_id,
                rrf_score=float(score),
                lexical_score=(lex.score if lex is not None else None),
                vector_score=(v.score if v is not None else None),
                metadata=metadata,
                text=text,
            )
        )
    return results


async def vector_only_search(
    query: str,
    *,
    top_k: int = 20,
    document_id: str | None = None,
) -> list[FusedHit]:
    """Run only the vector retriever and wrap results as ``FusedHit``."""
    if not query or not query.strip():
        return []

    embedder = get_embedder()
    vector_store = get_vector_store()
    query_embedding = embedder.embed([query], kind="query")[0]
    hits = vector_store.query(
        query_embedding,
        top_k=top_k,
        where=_build_where(document_id),
    )
    return [
        FusedHit(
            chunk_id=h.chunk_id,
            rrf_score=float(h.score),
            lexical_score=None,
            vector_score=h.score,
            metadata=dict(h.metadata),
            text=h.text,
        )
        for h in hits
    ]


async def lexical_only_search(
    query: str,
    *,
    top_k: int = 20,
    document_id: str | None = None,
) -> list[FusedHit]:
    """Run only the BM25 retriever and wrap results as ``FusedHit``."""
    if not query or not query.strip():
        return []

    lexical_index = get_lexical_index()
    hits = await lexical_index.query(
        query, top_k=top_k, document_id=document_id
    )
    return [
        FusedHit(
            chunk_id=h.chunk_id,
            rrf_score=float(h.score),
            lexical_score=h.score,
            vector_score=None,
            metadata=dict(h.metadata),
            text=h.text,
        )
        for h in hits
    ]


__all__ = [
    "FusedHit",
    "reciprocal_rank_fusion",
    "hybrid_search",
    "vector_only_search",
    "lexical_only_search",
]
