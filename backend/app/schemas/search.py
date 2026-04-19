"""Schemas for the /search endpoint."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    """Payload for POST /api/search."""

    query: str = Field(..., min_length=1, description="User query string.")
    top_k: int = Field(10, ge=1, le=100, description="Max results to return.")
    document_id: str | None = Field(
        default=None,
        description="If set, restrict retrieval to chunks of this document.",
    )
    mode: Literal["hybrid", "vector", "lexical"] = Field(
        default="hybrid", description="Which retriever(s) to run."
    )


class SearchHit(BaseModel):
    """A single ranked chunk returned by the search endpoint."""

    chunk_id: str
    document_id: str
    ordinal: int
    page_start: int
    page_end: int
    section_title: str | None
    text: str
    score_hybrid: float
    score_vector: float | None
    score_lexical: float | None


class SearchResponse(BaseModel):
    """Envelope returned by POST /api/search."""

    query: str
    mode: Literal["hybrid", "vector", "lexical"]
    results: list[SearchHit]


__all__ = ["SearchRequest", "SearchHit", "SearchResponse"]
