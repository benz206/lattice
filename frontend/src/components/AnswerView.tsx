"use client";

import { useMemo } from "react";
import type { AnswerResponse, Citation } from "@/lib/api";
import { EvidenceCard } from "./EvidenceCard";

interface AnswerViewProps {
  response: AnswerResponse;
  documentId: string;
}

interface Segment {
  kind: "text" | "citation";
  content: string;
  citationIndex?: number;
}

const CITATION_RE = /\[E(\d+)\]/g;

function splitAnswer(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index ?? 0;
    if (start > last) {
      segments.push({ kind: "text", content: text.slice(last, start) });
    }
    segments.push({
      kind: "citation",
      content: match[0],
      citationIndex: Number.parseInt(match[1], 10),
    });
    last = start + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", content: text.slice(last) });
  }
  return segments;
}

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
  citations: Citation[],
  idx: number,
): Citation | null {
  // Answers use 1-based [E#] referring to evidence ordering.
  const zero = idx - 1;
  if (zero < 0 || zero >= citations.length) {
    return null;
  }
  return citations[zero];
}

export function AnswerView({
  response,
  documentId,
}: AnswerViewProps): React.JSX.Element {
  const segments = useMemo(() => splitAnswer(response.answer ?? ""), [response.answer]);
  const band = confidenceBand(response.confidence);

  const handleJump = (chunkId: string) => {
    const el = document.getElementById(`evidence-${chunkId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-[color:var(--accent)]");
      window.setTimeout(() => {
        el.classList.remove("ring-2", "ring-[color:var(--accent)]");
      }, 1500);
    }
  };

  return (
    <div className="flex flex-col gap-6">
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
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">
            {segments.map((seg, i) => {
              if (seg.kind === "text") {
                return <span key={i}>{seg.content}</span>;
              }
              const citation =
                seg.citationIndex !== undefined
                  ? resolveCitation(response.citations, seg.citationIndex)
                  : null;
              if (!citation) {
                return (
                  <span key={i} className="text-muted">
                    {seg.content}
                  </span>
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleJump(citation.chunk_id)}
                  className="mx-0.5 inline-flex items-center rounded-sm bg-[color:var(--accent)] px-1.5 font-mono text-[11px] font-semibold text-[color:var(--accent-contrast)] transition hover:opacity-90"
                >
                  {seg.content}
                </button>
              );
            })}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Evidence ({response.evidence.length})
        </h3>
        {response.evidence.length === 0 ? (
          <p className="text-sm text-muted">No evidence retrieved.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {response.evidence.map((ev, i) => (
              <EvidenceCard
                key={ev.chunk_id}
                item={ev}
                documentId={documentId}
                idAttr={`evidence-${ev.chunk_id}`}
                label={`E${i + 1}`}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
