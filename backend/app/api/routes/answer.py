"""Answer endpoint: hybrid retrieval + LLM with cited evidence."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.answer import (
    AnswerRequest,
    AnswerResponse,
    CitationOut,
    EvidenceOut,
)
from app.services.answering import answer_query

router = APIRouter(prefix="/answer", tags=["answer"])


@router.post("", response_model=AnswerResponse)
async def post_answer(body: AnswerRequest) -> AnswerResponse:
    """Run the answering pipeline and return a grounded, cited answer."""
    result = await answer_query(
        body.query, top_k=body.top_k, document_id=body.document_id
    )
    return AnswerResponse(
        query=result.query,
        answer=result.answer,
        citations=[
            CitationOut(
                chunk_id=c.chunk_id,
                document_id=c.document_id,
                ordinal=c.ordinal,
                page_start=c.page_start,
                page_end=c.page_end,
                section_title=c.section_title,
            )
            for c in result.citations
        ],
        evidence=[
            EvidenceOut(
                chunk_id=e.chunk_id,
                document_id=e.document_id,
                ordinal=e.ordinal,
                page_start=e.page_start,
                page_end=e.page_end,
                section_title=e.section_title,
                text=e.text,
                score=e.score,
            )
            for e in result.evidence
        ],
        insufficient=result.insufficient,
        confidence=result.confidence,
        retrieval_meta=result.retrieval_meta,
    )


__all__ = ["router"]
