"use client";

import { useMemo, useState } from "react";
import type { AnswerResponse, Citation } from "@/lib/api";
import { EvidenceCard } from "./EvidenceCard";
import { MarkdownPreview } from "./MarkdownPreview";
import { ResultIntel } from "./ResultIntel";
import { ResultPagination } from "./ResultPagination";

interface AnswerViewProps {
  response: AnswerResponse;
  documentId: string;
}

const EVIDENCE_PAGE_SIZE = 4;

function confidenceBand(value: number): { label: string; className: string } {
  if (value >= 0.75) {
    return {
      label: "high",
      className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    };
  }
  if (value >= 0.4) {
    return {
      label: "medium",
      className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    };
  }
  return { label: "low", className: "bg-red-500/15 text-red-400 border-red-500/30" };
}

function resolveCitation(
  response: AnswerResponse,
  idx: number,
): Citation | null {
  // Answers use 1-based [E#] referring to evidence ordering.
  const zero = idx - 1;
  if (zero < 0 || zero >= response.evidence.length) {
    return null;
  }
  const evidence = response.evidence[zero];
  return (
    response.citations.find((citation) => citation.chunk_id === evidence.chunk_id) ??
    null
  );
}

export function AnswerView({
  response,
  documentId,
}: AnswerViewProps): React.JSX.Element {
  const band = confidenceBand(response.confidence);
  const [evidencePage, setEvidencePage] = useState<number>(1);
  const visibleEvidence = useMemo(() => {
    const start = (evidencePage - 1) * EVIDENCE_PAGE_SIZE;
    return response.evidence.slice(start, start + EVIDENCE_PAGE_SIZE);
  }, [evidencePage, response.evidence]);

  const handleJump = (chunkId: string, evidenceIndex: number) => {
    const targetPage = Math.floor(evidenceIndex / EVIDENCE_PAGE_SIZE) + 1;
    if (targetPage !== evidencePage) {
      setEvidencePage(targetPage);
    }
    window.setTimeout(() => {
      const el = document.getElementById(`evidence-${chunkId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ring-2", "ring-[color:var(--accent)]");
        window.setTimeout(() => {
          el.classList.remove("ring-2", "ring-[color:var(--accent)]");
        }, 1500);
      }
    }, 0);
  };

  return (
    <div className="flex flex-col gap-6">
      <ResultIntel
        title="What Lattice knows"
        query={response.query}
        items={response.evidence}
        answer={response}
      />

      <section className="surface-card rounded-lg border p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wide text-muted">
            Answer
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${band.className}`}
          >
            confidence {band.label} ({response.confidence.toFixed(2)})
          </span>
          <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 font-medium text-muted">
            answer score {response.answer_score.toFixed(2)}
          </span>
          {response.insufficient ? (
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400">
              insufficient evidence
            </span>
          ) : null}
          <span className="ml-auto text-muted">
            {response.retrieval_meta.hit_count} hits · top_k{" "}
            {response.retrieval_meta.top_k}
          </span>
        </div>

        {response.insufficient ? (
          <p className="mt-4 text-sm text-muted">
            Insufficient evidence to answer this question from the retrieved context.
            The model has declined to answer; raw evidence is shown below.
          </p>
        ) : (
          <MarkdownPreview
            text={response.answer ?? ""}
            renderCitation={(label, citationIndex, key) => {
              const citation = resolveCitation(response, citationIndex);
              if (!citation) {
                return (
                  <span key={key} className="text-muted">
                    {label}
                  </span>
                );
              }
              const evidenceIndex = citationIndex - 1;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleJump(citation.chunk_id, evidenceIndex)}
                  className="mx-0.5 inline-flex items-center rounded-sm bg-[color:var(--accent)] px-1.5 font-mono text-[11px] font-semibold text-[color:var(--accent-contrast)] transition hover:opacity-90"
                >
                  {label}
                </button>
              );
            }}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Evidence ({response.evidence.length})
            </h3>
            <p className="mt-1 text-xs text-muted">
              Ranked passages used to ground the answer. Citation buttons jump to
              their source passage, including across pages.
            </p>
          </div>
        </div>
        {response.evidence.length === 0 ? (
          <p className="text-sm text-muted">No evidence retrieved.</p>
        ) : (
          <>
            <ResultPagination
              page={evidencePage}
              pageSize={EVIDENCE_PAGE_SIZE}
              total={response.evidence.length}
              onPageChange={setEvidencePage}
            />
            <div className="flex flex-col gap-3">
              {visibleEvidence.map((ev, i) => {
                const absoluteIndex = (evidencePage - 1) * EVIDENCE_PAGE_SIZE + i;
                return (
                  <EvidenceCard
                    key={ev.chunk_id}
                    item={ev}
                    documentId={documentId}
                    idAttr={`evidence-${ev.chunk_id}`}
                    label={`E${absoluteIndex + 1}`}
                  />
                );
              })}
            </div>
            <ResultPagination
              page={evidencePage}
              pageSize={EVIDENCE_PAGE_SIZE}
              total={response.evidence.length}
              onPageChange={setEvidencePage}
            />
          </>
        )}
      </section>
    </div>
  );
}
