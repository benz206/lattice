"""Synthetic-corpus retrieval benchmark.

Builds a small PDF corpus with planted facts, ingests it, and measures hybrid /
vector-only / lexical-only retrieval on the planted questions. Reports
Recall@1/5/10, MRR, and median latency per mode.

Exits non-zero if hybrid Recall@10 falls below ``MIN_HYBRID_RECALL_AT_10``.

Usage::

    cd backend
    LATTICE_EMBEDDER=hash LATTICE_LLM=stub python scripts/eval_retrieval.py
"""

from __future__ import annotations

import asyncio
import os
import statistics
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

# Redirect on-disk state to a tmpdir BEFORE importing the app modules so the
# engine/settings are constructed against the eval paths.
_TMPDIR = tempfile.mkdtemp(prefix="lattice-eval-")
os.environ.setdefault("DATA_DIR", _TMPDIR)
os.environ.setdefault("UPLOAD_DIR", str(Path(_TMPDIR) / "uploads"))
os.environ.setdefault("VECTOR_STORE_DIR", str(Path(_TMPDIR) / "vectorstore"))
os.environ.setdefault("SQLITE_PATH", str(Path(_TMPDIR) / "eval.db"))
os.environ.setdefault("LATTICE_EMBEDDER", "hash")
os.environ.setdefault("LATTICE_LLM", "stub")

# Project root so we can import tests.fixtures without pip-installing it.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.session import async_session_maker, init_db  # noqa: E402
from app.models.chunk import Chunk  # noqa: E402
from app.models.document import Document  # noqa: E402
from app.services.ingestion import ingest_document  # noqa: E402
from app.services.retrieval import (  # noqa: E402
    hybrid_search,
    lexical_only_search,
    vector_only_search,
)
from tests.fixtures.build_sample_corpus import (  # noqa: E402
    CorpusDocument,
    PlantedFact,
    build_sample_corpus,
)

MIN_HYBRID_RECALL_AT_10: float = 0.5


@dataclass
class EvalQuery:
    """One benchmark query bound to a known ground-truth chunk id."""

    question: str
    expected_chunk_id: str
    document_id: str
    fact: PlantedFact


@dataclass
class ModeReport:
    """Aggregated metrics for one retrieval mode."""

    mode: str
    recall_at_1: float
    recall_at_5: float
    recall_at_10: float
    mrr: float
    median_latency_ms: float
    samples: int


async def _register_document(path: Path) -> str:
    document_id = str(uuid.uuid4())
    size = path.stat().st_size
    async with async_session_maker() as session:
        session.add(
            Document(
                id=document_id,
                filename=path.name,
                content_type="application/pdf",
                size_bytes=size,
                status="pending",
                storage_path=str(path),
            )
        )
        await session.commit()
        await ingest_document(session, document_id)
    return document_id


async def _ground_truth_chunk_ids(
    document_id: str, facts: tuple[PlantedFact, ...]
) -> dict[str, str]:
    """Return ``fact.question -> chunk_id`` using the planted sentence."""
    async with async_session_maker() as session:
        result = await session.execute(
            select(Chunk.id, Chunk.text, Chunk.page_start, Chunk.page_end)
            .where(Chunk.document_id == document_id)
            .order_by(Chunk.ordinal)
        )
        rows = result.all()

    out: dict[str, str] = {}
    for fact in facts:
        planted_prefix = fact.answer_sentence[:40]
        matching = [
            row
            for row in rows
            if planted_prefix in (row.text or "")
            and row.page_start <= fact.page <= row.page_end
        ]
        if not matching:
            matching = [row for row in rows if planted_prefix in (row.text or "")]
        if not matching:
            raise RuntimeError(
                f"No chunk contains the planted sentence for question: {fact.question!r}"
            )
        out[fact.question] = matching[0].id
    return out


def _rank_of(chunk_id: str, ordered_ids: list[str]) -> int | None:
    for i, other in enumerate(ordered_ids):
        if other == chunk_id:
            return i + 1
    return None


async def _run_mode(mode: str, queries: list[EvalQuery], top_k: int) -> ModeReport:
    latencies: list[float] = []
    ranks: list[int | None] = []
    for q in queries:
        start = time.perf_counter()
        if mode == "hybrid":
            hits = await hybrid_search(q.question, top_k=top_k)
        elif mode == "vector":
            hits = await vector_only_search(q.question, top_k=top_k)
        elif mode == "lexical":
            hits = await lexical_only_search(q.question, top_k=top_k)
        else:
            raise ValueError(f"unknown mode: {mode!r}")
        latencies.append((time.perf_counter() - start) * 1000.0)
        ranks.append(_rank_of(q.expected_chunk_id, [h.chunk_id for h in hits]))

    def _recall_at(k: int) -> float:
        hits_at = sum(1 for r in ranks if r is not None and r <= k)
        return hits_at / len(ranks) if ranks else 0.0

    mrr = (
        sum((1.0 / r) if r is not None else 0.0 for r in ranks) / len(ranks)
        if ranks
        else 0.0
    )
    median_latency = statistics.median(latencies) if latencies else 0.0

    return ModeReport(
        mode=mode,
        recall_at_1=_recall_at(1),
        recall_at_5=_recall_at(5),
        recall_at_10=_recall_at(10),
        mrr=mrr,
        median_latency_ms=median_latency,
        samples=len(queries),
    )


def _print_report(reports: list[ModeReport]) -> None:
    header = (
        f"{'mode':<10}"
        f"{'n':>5}"
        f"{'R@1':>8}"
        f"{'R@5':>8}"
        f"{'R@10':>8}"
        f"{'MRR':>8}"
        f"{'p50 ms':>10}"
    )
    print(header)
    print("-" * len(header))
    for r in reports:
        print(
            f"{r.mode:<10}"
            f"{r.samples:>5}"
            f"{r.recall_at_1:>8.3f}"
            f"{r.recall_at_5:>8.3f}"
            f"{r.recall_at_10:>8.3f}"
            f"{r.mrr:>8.3f}"
            f"{r.median_latency_ms:>10.1f}"
        )


async def run() -> int:
    settings.ensure_dirs()
    await init_db()

    corpus_dir = Path(_TMPDIR) / "corpus"
    corpus: list[CorpusDocument] = build_sample_corpus(corpus_dir)

    queries: list[EvalQuery] = []
    for doc in corpus:
        document_id = await _register_document(doc.path)
        gt = await _ground_truth_chunk_ids(document_id, doc.facts)
        for fact in doc.facts:
            queries.append(
                EvalQuery(
                    question=fact.question,
                    expected_chunk_id=gt[fact.question],
                    document_id=document_id,
                    fact=fact,
                )
            )

    print(
        f"Corpus: {len(corpus)} documents, "
        f"{sum(len(d.facts) for d in corpus)} planted questions.\n"
    )

    reports = []
    for mode in ("hybrid", "vector", "lexical"):
        reports.append(await _run_mode(mode, queries, top_k=10))

    _print_report(reports)

    hybrid = next(r for r in reports if r.mode == "hybrid")
    print()
    if hybrid.recall_at_10 < MIN_HYBRID_RECALL_AT_10:
        print(
            f"FAIL: hybrid Recall@10 = {hybrid.recall_at_10:.3f} "
            f"< floor {MIN_HYBRID_RECALL_AT_10:.2f}"
        )
        return 1
    print(
        f"OK: hybrid Recall@10 = {hybrid.recall_at_10:.3f} "
        f">= floor {MIN_HYBRID_RECALL_AT_10:.2f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
