"""Answering pipeline: hybrid retrieval -> evidence prompt -> cited answer."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.adapters.llm import LlmProtocol, Message, get_llm
from app.services.retrieval import FusedHit, hybrid_search

# Tunable thresholds (NOT env-driven for MVP).
# Note: RRF scores with ``alpha=0.5`` and the default ``k=60`` are small by
# construction (theoretical max ~0.016), so ``MIN_TOP_SCORE`` is calibrated to
# flag essentially-empty retrieval rather than weak-but-real matches; the
# dual-signal exception still applies.
MIN_TOP_SCORE: float = 0.005
MIN_HITS: int = 1
MAX_CONTEXT_CHARS: int = 6000
RRF_TOP_SCORE: float = 1.0 / 61.0

INSUFFICIENT_MARKER: str = "INSUFFICIENT_EVIDENCE"
INSUFFICIENT_ANSWER: str = "Insufficient evidence to answer."

_CITATION_RE = re.compile(
    r"\[\s*[\u200b-\u200f\u2060\ufeff]*E"
    r"[\u200b-\u200f\u2060\ufeff]*(\d+)"
    r"[\u200b-\u200f\u2060\ufeff]*\s*\]"
)


@dataclass(frozen=True)
class Citation:
    """A resolved ``[E#]`` reference pointing at a chunk."""

    chunk_id: str
    document_id: str
    ordinal: int
    page_start: int
    page_end: int
    section_title: str | None


@dataclass
class EvidencePassage:
    """A retrieved passage assembled into the LLM prompt."""

    chunk_id: str
    document_id: str
    ordinal: int
    page_start: int
    page_end: int
    section_title: str | None
    text: str
    score: float


@dataclass
class AnswerResult:
    """The full output of ``answer_query``."""

    query: str
    answer: str
    citations: list[Citation] = field(default_factory=list)
    evidence: list[EvidencePassage] = field(default_factory=list)
    insufficient: bool = False
    confidence: float = 0.0
    answer_score: float = 0.0
    retrieval_meta: dict[str, Any] = field(default_factory=dict)


def _passage_from_hit(hit: FusedHit) -> EvidencePassage | None:
    meta = hit.metadata or {}
    document_id = meta.get("document_id")
    if not document_id:
        return None
    section = meta.get("section_title")
    if section in ("", None):
        section = None
    return EvidencePassage(
        chunk_id=hit.chunk_id,
        document_id=str(document_id),
        ordinal=int(meta.get("ordinal") or 0),
        page_start=int(meta.get("page_start") or 0),
        page_end=int(meta.get("page_end") or 0),
        section_title=section,
        text=hit.text or "",
        score=float(hit.rrf_score),
    )


def _truncate_at_boundary(text: str, max_len: int) -> str:
    """Trim ``text`` to at most ``max_len`` chars at the nearest space boundary."""
    if max_len <= 0:
        return ""
    if len(text) <= max_len:
        return text
    cut = text[:max_len]
    space = cut.rfind(" ")
    if space > int(max_len * 0.5):
        cut = cut[:space]
    return cut.rstrip()


def _cap_passages(passages: list[EvidencePassage], cap: int) -> list[EvidencePassage]:
    """Cap cumulative ``len(text)`` to ``cap`` chars; truncate the trailing one."""
    out: list[EvidencePassage] = []
    used = 0
    for p in passages:
        remaining = cap - used
        if remaining <= 0:
            break
        if len(p.text) <= remaining:
            out.append(p)
            used += len(p.text)
            continue
        truncated = _truncate_at_boundary(p.text, remaining)
        if not truncated:
            break
        out.append(
            EvidencePassage(
                chunk_id=p.chunk_id,
                document_id=p.document_id,
                ordinal=p.ordinal,
                page_start=p.page_start,
                page_end=p.page_end,
                section_title=p.section_title,
                text=truncated,
                score=p.score,
            )
        )
        used += len(truncated)
        break
    return out


def build_prompt(query: str, passages: list[EvidencePassage]) -> list[Message]:
    """Assemble the chat-style prompt sent to the LLM."""
    system: Message = {
        "role": "system",
        "content": (
            "You are a careful evidence-grounded assistant. "
            "Answer ONLY using facts found in the EVIDENCE section. "
            "Cite supporting passages inline using the bracket form [E#] where # "
            "matches the 1-based index of the passage in the EVIDENCE list. "
            "If the evidence is insufficient or the question cannot be answered "
            "from the evidence, reply with the literal string "
            f"{INSUFFICIENT_MARKER} and nothing else. Do not fabricate."
        ),
    }

    lines: list[str] = [f"QUESTION: {query}", "", "EVIDENCE:"]
    if not passages:
        lines.append("(none)")
    else:
        for i, p in enumerate(passages, start=1):
            header = (
                f"[E{i}] (chunk={p.chunk_id} doc={p.document_id} "
                f"pages={p.page_start}-{p.page_end})"
            )
            lines.append(header)
            lines.append(p.text)
            lines.append("")
    lines.append("Write a concise answer that cites passages using [E#].")

    user: Message = {"role": "user", "content": "\n".join(lines)}
    return [system, user]


def parse_citations(answer: str, passages: list[EvidencePassage]) -> list[Citation]:
    """Extract ``[E#]`` references from ``answer`` and resolve to passages.

    De-dupes preserving first-seen order; out-of-range indices are skipped.
    """
    if not answer or not passages:
        return []
    seen: set[int] = set()
    out: list[Citation] = []
    for match in _CITATION_RE.finditer(answer):
        try:
            idx = int(match.group(1))
        except ValueError:
            continue
        if idx in seen:
            continue
        if idx < 1 or idx > len(passages):
            continue
        seen.add(idx)
        p = passages[idx - 1]
        out.append(
            Citation(
                chunk_id=p.chunk_id,
                document_id=p.document_id,
                ordinal=p.ordinal,
                page_start=p.page_start,
                page_end=p.page_end,
                section_title=p.section_title,
            )
        )
    return out


def normalize_citation_tokens(answer: str) -> str:
    """Canonicalize model-emitted citation tokens to plain ``[E#]`` form."""
    return _CITATION_RE.sub(lambda match: f"[E{int(match.group(1))}]", answer)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def estimate_confidence(
    passages: list[EvidencePassage], citation_count: int | bool
) -> float:
    """Estimate confidence from normalized retrieval strength and citation support.

    Hybrid answers use RRF scores, whose useful range is roughly 0..1/61 for
    the top fused result. Normalize against that range before applying citation
    and evidence-volume factors so good retrieval does not look artificially
    weak in the UI.
    """
    if not passages:
        return 0.0
    max_score = max(p.score for p in passages)
    retrieval_strength = _clamp01(max_score / RRF_TOP_SCORE)
    cited = int(citation_count)
    citation_factor = 0.35 + (0.65 * _clamp01(cited / 2.0))
    evidence_factor = 0.75 + (0.25 * _clamp01(len(passages) / 3.0))
    return _clamp01(retrieval_strength * citation_factor * evidence_factor)


def estimate_answer_score(
    *,
    answer: str,
    confidence: float,
    citation_count: int,
    insufficient: bool,
) -> float:
    """Score answer usability on 0..1 using confidence, citations, and content."""
    if insufficient or not answer.strip():
        return 0.0
    citation_factor = 0.55 + (0.45 * _clamp01(citation_count / 2.0))
    length_factor = _clamp01(len(answer.strip()) / 160.0)
    content_factor = 0.8 + (0.2 * length_factor)
    return _clamp01(confidence * citation_factor * content_factor)


def _max_score(hits: list[FusedHit]) -> float:
    return max((h.rrf_score for h in hits), default=0.0)


def _has_dual_signal(hits: list[FusedHit]) -> bool:
    return any(
        (h.vector_score is not None and h.vector_score > 0)
        and (h.lexical_score is not None and h.lexical_score > 0)
        for h in hits
    )


async def answer_query(
    query: str,
    *,
    top_k: int = 8,
    document_id: str | None = None,
    llm: LlmProtocol | None = None,
) -> AnswerResult:
    """Run hybrid retrieval, prompt the LLM, parse citations, and return a result."""
    alpha = 0.5
    hits = await hybrid_search(query, top_k=top_k, document_id=document_id, alpha=alpha)

    raw_passages: list[EvidencePassage] = []
    for h in hits:
        p = _passage_from_hit(h)
        if p is not None:
            raw_passages.append(p)

    passages = _cap_passages(raw_passages, MAX_CONTEXT_CHARS)
    max_score = _max_score(hits)

    backend = llm or get_llm()
    retrieval_meta: dict[str, Any] = {
        "hit_count": len(hits),
        "max_score": float(max_score),
        "alpha": alpha,
        "top_k": top_k,
        "model": backend.name,
        "scoring": {
            "confidence": 0.0,
            "answer_score": 0.0,
            "citation_count": 0,
            "rrf_top_score": RRF_TOP_SCORE,
        },
    }

    insufficient_by_score = max_score < MIN_TOP_SCORE and not _has_dual_signal(hits)
    if len(passages) < MIN_HITS or insufficient_by_score:
        return AnswerResult(
            query=query,
            answer=INSUFFICIENT_ANSWER,
            citations=[],
            evidence=passages,
            insufficient=True,
            confidence=0.0,
            answer_score=0.0,
            retrieval_meta=retrieval_meta,
        )

    messages = build_prompt(query, passages)
    raw_answer = await backend.generate(messages, max_tokens=2048, temperature=0.0)
    answer = normalize_citation_tokens((raw_answer or "").strip())

    if answer == INSUFFICIENT_MARKER:
        return AnswerResult(
            query=query,
            answer=INSUFFICIENT_ANSWER,
            citations=[],
            evidence=passages,
            insufficient=True,
            confidence=0.0,
            answer_score=0.0,
            retrieval_meta=retrieval_meta,
        )

    citations = parse_citations(answer, passages)
    confidence = estimate_confidence(passages, len(citations))
    answer_score = estimate_answer_score(
        answer=answer,
        confidence=confidence,
        citation_count=len(citations),
        insufficient=False,
    )
    retrieval_meta["scoring"] = {
        "confidence": confidence,
        "answer_score": answer_score,
        "citation_count": len(citations),
        "rrf_top_score": RRF_TOP_SCORE,
    }

    return AnswerResult(
        query=query,
        answer=answer,
        citations=citations,
        evidence=passages,
        insufficient=False,
        confidence=confidence,
        answer_score=answer_score,
        retrieval_meta=retrieval_meta,
    )


__all__ = [
    "Citation",
    "EvidencePassage",
    "AnswerResult",
    "MIN_TOP_SCORE",
    "MIN_HITS",
    "MAX_CONTEXT_CHARS",
    "RRF_TOP_SCORE",
    "INSUFFICIENT_MARKER",
    "INSUFFICIENT_ANSWER",
    "build_prompt",
    "parse_citations",
    "normalize_citation_tokens",
    "estimate_confidence",
    "estimate_answer_score",
    "answer_query",
]
