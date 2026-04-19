"""Schemas for the /answer endpoint."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CitationOut(BaseModel):
    """A single resolved citation referencing a chunk."""

    chunk_id: str
    document_id: str
    ordinal: int
    page_start: int
    page_end: int
    section_title: str | None


class EvidenceOut(BaseModel):
    """An evidence passage assembled into the LLM context."""

    chunk_id: str
    document_id: str
    ordinal: int
    page_start: int
    page_end: int
    section_title: str | None
    text: str
    score: float


class AnswerRequest(BaseModel):
    """Payload for POST /api/answer."""

    query: str = Field(..., min_length=1, description="User question.")
    top_k: int = Field(8, ge=1, le=50, description="Max evidence passages to retrieve.")
    document_id: str | None = Field(
        default=None,
        description="If set, restrict retrieval to chunks of this document.",
    )


class AnswerResponse(BaseModel):
    """Envelope returned by POST /api/answer."""

    query: str
    answer: str
    citations: list[CitationOut]
    evidence: list[EvidenceOut]
    insufficient: bool
    confidence: float
    retrieval_meta: dict[str, Any]


__all__ = [
    "CitationOut",
    "EvidenceOut",
    "AnswerRequest",
    "AnswerResponse",
]
