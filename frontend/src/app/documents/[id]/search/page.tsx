"use client";

import Link from "next/link";
import { use, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { EvidenceCard } from "@/components/EvidenceCard";
import { Spinner } from "@/components/Spinner";
import {
  ApiError,
  search,
  type SearchHit,
  type SearchMode,
  type SearchResponse,
} from "@/lib/api";

interface PageProps {
  params: Promise<{ id: string }>;
}

const MODES: SearchMode[] = ["hybrid", "vector", "lexical"];

export default function SearchPage({ params }: PageProps): React.JSX.Element {
  const { id } = use(params);

  const [query, setQuery] = useState<string>("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [topK, setTopK] = useState<number>(10);
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState<string>("");
  const [submittedMode, setSubmittedMode] = useState<SearchMode>("hybrid");
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const resp: SearchResponse = await search({
        query: q,
        mode,
        top_k: topK,
        document_id: id,
      });
      setResults(resp.results);
      setSubmittedQuery(resp.query);
      setSubmittedMode(resp.mode);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Search failed";
      setError(message);
      setResults(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <AppHeader subtitle="Search" />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Search chunks</h1>
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
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms or a natural-language query..."
          className="w-full rounded-md border border-line bg-[color:var(--background)] px-3 py-2 text-sm focus:border-[color:var(--accent)] focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              mode
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as SearchMode)}
                className="rounded-md border border-line bg-[color:var(--background)] px-2 py-1 text-xs"
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              top_k
              <input
                type="number"
                min={1}
                max={50}
                value={topK}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) {
                    setTopK(Math.max(1, Math.min(50, n)));
                  }
                }}
                className="w-16 rounded-md border border-line bg-[color:var(--background)] px-2 py-1 text-center text-xs"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={pending || query.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)] disabled:opacity-50"
          >
            {pending ? <Spinner size={14} /> : null}
            Search
          </button>
        </div>
      </form>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      {results !== null ? (
        <section className="flex flex-col gap-3">
          <div className="text-xs text-muted">
            {results.length} result{results.length === 1 ? "" : "s"} for
            <span className="mx-1 font-medium text-[color:var(--foreground)]">
              {submittedQuery}
            </span>
            · mode {submittedMode}
          </div>
          <div className="flex flex-col gap-3">
            {results.map((hit, i) => (
              <EvidenceCard
                key={hit.chunk_id}
                item={hit}
                documentId={id}
                label={`#${i + 1}`}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
