"""BM25 lexical index built lazily from persisted chunks.

The index rebuilds on demand (first query after invalidation). This keeps
ingestion simple at the current scale; a more incremental strategy can be
swapped in later without changing callers.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable

from rank_bm25 import BM25Okapi
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.session import async_session_maker as default_session_maker
from app.models.chunk import Chunk
from app.services.chunk_enrich import _STOPWORDS as _ENRICH_STOPWORDS

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


@dataclass(frozen=True)
class LexicalHit:
    """One BM25 match."""

    chunk_id: str
    score: float
    metadata: dict[str, Any]
    text: str


def _tokenize(text: str) -> list[str]:
    if not text:
        return []
    out: list[str] = []
    for match in _TOKEN_RE.findall(text.lower()):
        if len(match) < 2:
            continue
        if match in _ENRICH_STOPWORDS:
            continue
        out.append(match)
    return out


class LexicalIndex:
    """Lazy-rebuilding BM25 index backed by the chunks table."""

    def __init__(
        self,
        session_factory: Callable[[], AsyncSession] | async_sessionmaker[AsyncSession],
    ) -> None:
        self._session_factory = session_factory
        self._lock = asyncio.Lock()
        self._bm25: BM25Okapi | None = None
        self._chunk_ids: list[str] = []
        self._texts: list[str] = []
        self._metadatas: list[dict[str, Any]] = []
        self._stale: bool = True

    @property
    def size(self) -> int:
        return len(self._chunk_ids)

    def _open_session(self) -> AsyncSession:
        factory = self._session_factory
        # ``async_sessionmaker`` instances are callable and return a session too.
        return factory()

    async def _load_corpus(self) -> None:
        async with self._open_session() as session:
            result = await session.execute(
                select(
                    Chunk.id,
                    Chunk.text,
                    Chunk.document_id,
                    Chunk.ordinal,
                    Chunk.page_start,
                    Chunk.page_end,
                    Chunk.section_title,
                ).order_by(Chunk.document_id, Chunk.ordinal)
            )
            rows = result.all()

        self._chunk_ids = [row.id for row in rows]
        self._texts = [row.text or "" for row in rows]
        self._metadatas = [
            {
                "document_id": row.document_id,
                "ordinal": row.ordinal,
                "page_start": row.page_start,
                "page_end": row.page_end,
                "section_title": row.section_title or "",
            }
            for row in rows
        ]

        tokenized = [_tokenize(t) for t in self._texts]
        # BM25Okapi requires at least one non-empty doc to avoid a divide-by-zero.
        if tokenized and any(tokens for tokens in tokenized):
            self._bm25 = BM25Okapi(tokenized)
        else:
            self._bm25 = None

    async def rebuild(self) -> None:
        """Force a fresh rebuild from SQLite."""
        async with self._lock:
            logger.info("lexical_index rebuild start")
            await self._load_corpus()
            self._stale = False
            logger.info("lexical_index rebuild done size=%d", self.size)

    async def _ensure_ready(self) -> None:
        if not self._stale and self._bm25 is not None:
            return
        async with self._lock:
            if not self._stale and self._bm25 is not None:
                return
            await self._load_corpus()
            self._stale = False

    async def query(
        self,
        text: str,
        *,
        top_k: int = 20,
        document_id: str | None = None,
    ) -> list[LexicalHit]:
        await self._ensure_ready()
        if self._bm25 is None or not self._chunk_ids:
            return []

        tokens = _tokenize(text)
        if not tokens:
            return []

        scores = self._bm25.get_scores(tokens)

        filtered: list[tuple[int, float]] = []
        for i, score in enumerate(scores):
            if document_id is not None and self._metadatas[i].get("document_id") != document_id:
                continue
            if score <= 0.0:
                continue
            filtered.append((i, float(score)))

        filtered.sort(key=lambda x: x[1], reverse=True)
        filtered = filtered[: max(1, int(top_k))]

        return [
            LexicalHit(
                chunk_id=self._chunk_ids[i],
                score=score,
                metadata=dict(self._metadatas[i]),
                text=self._texts[i],
            )
            for i, score in filtered
        ]

    async def invalidate(self) -> None:
        """Mark the cached corpus as stale; the next query will rebuild."""
        async with self._lock:
            self._stale = True
            self._bm25 = None
        logger.info("lexical_index invalidated")

    async def upsert_document(self, document_id: str) -> None:
        """MVP: just invalidate the whole index on any document change."""
        logger.info("lexical_index upsert_document document_id=%s", document_id)
        await self.invalidate()

    async def delete_document(self, document_id: str) -> None:
        """MVP: just invalidate the whole index on delete."""
        logger.info("lexical_index delete_document document_id=%s", document_id)
        await self.invalidate()


_singleton: LexicalIndex | None = None


def get_lexical_index() -> LexicalIndex:
    """Process-wide lexical index singleton."""
    global _singleton
    if _singleton is None:
        _singleton = LexicalIndex(default_session_maker)
    return _singleton


def reset_lexical_index() -> None:
    """Clear the cached index (primarily useful in tests)."""
    global _singleton
    _singleton = None


__all__ = [
    "LexicalHit",
    "LexicalIndex",
    "get_lexical_index",
    "reset_lexical_index",
]
