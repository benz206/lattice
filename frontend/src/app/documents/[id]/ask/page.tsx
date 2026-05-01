"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ActivityRail, type ActivityStep } from "@/components/ActivityRail";
import { AppHeader } from "@/components/AppHeader";
import { AnswerView } from "@/components/AnswerView";
import { Spinner } from "@/components/Spinner";
import { answer, ApiError, type AnswerResponse } from "@/lib/api";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface Turn {
  id: number;
  query: string;
  top_k: number;
  response: AnswerResponse | null;
  error: string | null;
  pending: boolean;
}

function answerSteps(turn: Turn): ActivityStep[] {
  const failed = Boolean(turn.error);
  const done = Boolean(turn.response);
  const activeState = failed ? "error" : turn.pending ? "active" : done ? "done" : "waiting";
  const response = turn.response;
  return [
    {
      label: "Question",
      detail: "Captured and scoped to this document.",
      state: failed || turn.pending || done ? "done" : "waiting",
      metric: `top_k ${turn.top_k}`,
    },
    {
      label: "Evidence",
      detail: response
        ? `Fetched ${response.evidence.length} passages across source pages.`
        : "Fetching ranked chunks and page spans.",
      state: activeState,
      metric: response ? `${response.evidence.length} hits` : undefined,
    },
    {
      label: "Scoring",
      detail: response
        ? `Confidence ${response.confidence.toFixed(2)} and answer score ${response.answer_score.toFixed(2)}.`
        : "Normalizing retrieval, citation, and answer signals.",
      state: response ? "done" : activeState,
      metric: response ? response.answer_score.toFixed(2) : undefined,
    },
    {
      label: "Answer",
      detail: failed
        ? turn.error ?? "Request failed."
        : response
          ? response.insufficient
            ? "Insufficient evidence state is visible."
            : "Answer, citations, LaTeX previews, and evidence are visible."
          : "Composing grounded answer.",
      state: failed ? "error" : response ? "done" : turn.pending ? "active" : "waiting",
      metric: response ? `${response.citations.length} cites` : undefined,
    },
  ];
}

export default function AskPage({ params }: PageProps): React.JSX.Element {
  const { id } = use(params);

  const [query, setQuery] = useState<string>("");
  const [topK, setTopK] = useState<number>(8);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length === 0 || submitting) return;

    const turnId = Date.now();
    const turn: Turn = {
      id: turnId,
      query: q,
      top_k: topK,
      response: null,
      error: null,
      pending: true,
    };
    setTurns((prev) => [turn, ...prev]);
    setQuery("");
    setSubmitting(true);

    try {
      const resp = await answer({ query: q, top_k: topK, document_id: id });
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, response: resp, pending: false } : t,
        ),
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Request failed";
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, error: message, pending: false } : t,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <AppHeader subtitle="Ask" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ask a question</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Lattice retrieves evidence first, then asks the model to answer only
            from those passages. Each turn shows the answer, citations, retrieval
            metadata, and paginated source evidence.
          </p>
        </div>
        <Link
          href={`/documents/${id}`}
          className="text-sm text-[color:var(--accent)] hover:underline"
        >
          Back to document
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className="surface-card flex flex-col gap-4 rounded-lg border p-4"
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a grounded question about this document..."
          rows={3}
          className="w-full resize-y rounded-md border border-line bg-[color:var(--background)] px-3 py-2 text-sm focus:border-[color:var(--accent)] focus:outline-none"
        />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            evidence depth
            <input
              type="number"
              min={3}
              max={50}
              value={topK}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) {
                  setTopK(Math.max(3, Math.min(50, n)));
                }
              }}
              className="w-16 rounded-md border border-line bg-[color:var(--background)] px-2 py-1 text-center text-xs"
            />
          </label>
          <button
            type="submit"
            disabled={submitting || query.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)] disabled:opacity-50"
          >
            {submitting ? <Spinner size={14} /> : null}
            Ask
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-10">
        {turns.length === 0 ? (
          <p className="text-sm text-muted">
            Questions and answers will appear here. This chat is kept only for this
            session.
          </p>
        ) : null}
        {turns.map((t) => (
          <section key={t.id} className="flex flex-col gap-4">
            <div className="surface-card rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Question
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{t.query}</p>
                </div>
                <div className="rounded-md border border-line px-3 py-2 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Evidence depth
                  </p>
                  <p className="text-sm font-medium">{t.top_k}</p>
                </div>
              </div>
            </div>

            <ActivityRail title="Answer pipeline" steps={answerSteps(t)} />

            {t.pending ? (
              <div className="inline-flex items-center gap-2 text-sm text-muted">
                <Spinner size={14} /> Retrieving evidence and composing an answer…
              </div>
            ) : null}

            {t.error ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {t.error}
              </div>
            ) : null}

            {t.response ? (
              <AnswerView response={t.response} documentId={id} />
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
