"use client";

import Link from "next/link";
import { use, useState } from "react";
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

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Ask a question</h1>
        <Link
          href={`/documents/${id}`}
          className="text-sm text-[color:var(--accent)] hover:underline"
        >
          Back to document
        </Link>
      </div>

      <form
        onSubmit={onSubmit}
        className="surface-card flex flex-col gap-3 rounded-xl border p-4"
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a grounded question about this document..."
          rows={3}
          className="w-full resize-y rounded-md border border-line bg-[color:var(--background)] px-3 py-2 text-sm focus:border-[color:var(--accent)] focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            top_k
            <input
              type="number"
              min={3}
              max={20}
              value={topK}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) {
                  setTopK(Math.max(3, Math.min(20, n)));
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
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Question
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{t.query}</p>
              <p className="mt-2 text-[11px] text-muted">top_k {t.top_k}</p>
            </div>

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
