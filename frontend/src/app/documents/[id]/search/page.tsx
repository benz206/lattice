"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { ActivityRail, type ActivityStep } from "@/components/ActivityRail";
import { AppHeader } from "@/components/AppHeader";
import { EvidenceCard } from "@/components/EvidenceCard";
import { ResultIntel } from "@/components/ResultIntel";
import { ResultPagination } from "@/components/ResultPagination";
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
const RESULT_PAGE_SIZE = 5;

function searchSteps({
  pending,
  error,
  results,
  mode,
  topK,
}: {
  pending: boolean;
  error: string | null;
  results: SearchHit[] | null;
  mode: SearchMode;
  topK: number;
}): ActivityStep[] {
  const hasResults = results !== null;
  const activeState: ActivityStep["state"] = error
    ? "error"
    : pending
      ? "active"
      : hasResults
        ? "done"
        : "waiting";
  return [
    {
      label: "Query",
      detail: "Search terms are scoped to this document.",
      state: pending || hasResults || error ? "done" : "waiting",
      metric: mode,
    },
    {
      label: "Fetch",
      detail: hasResults
        ? `Fetched ${results.length} matching chunks and page spans.`
        : "Fetching candidate chunks from the index.",
      state: activeState,
      metric: `top_k ${topK}`,
    },
    {
      label: "Score",
      detail: hasResults
        ? "Hybrid, vector, and lexical signals are shown on each card."
        : "Ranking and normalizing retrieval scores.",
      state: hasResults ? "done" : activeState,
      metric: hasResults ? `${results.length} hits` : undefined,
    },
    {
      label: "Inspect",
      detail: error ?? (hasResults ? "Results, pages, sections, and score bars are visible." : "Waiting for results."),
      state: error ? "error" : hasResults ? "done" : pending ? "active" : "waiting",
      metric: hasResults ? `${Math.ceil(results.length / RESULT_PAGE_SIZE)} pages` : undefined,
    },
  ];
}

export default function SearchPage({ params }: PageProps): React.JSX.Element {
  const { id } = use(params);

  const [query, setQuery] = useState<string>("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [topK, setTopK] = useState<number>(10);
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [submittedQuery, setSubmittedQuery] = useState<string>("");
  const [submittedMode, setSubmittedMode] = useState<SearchMode>("hybrid");
  const [page, setPage] = useState<number>(1);
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const visibleResults = useMemo(() => {
    if (!results) return [];
    const start = (page - 1) * RESULT_PAGE_SIZE;
    return results.slice(start, start + RESULT_PAGE_SIZE);
  }, [page, results]);

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
      setPage(1);
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

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Search evidence</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Retrieve ranked chunks from this document, then inspect the pages,
            sections, scoring signals, and exact source text behind each hit.
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
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms or a natural-language query..."
          className="w-full rounded-md border border-line bg-[color:var(--background)] px-3 py-2 text-sm focus:border-[color:var(--accent)] focus:outline-none"
        />
        <div className="flex flex-wrap items-end justify-between gap-3">
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
              retrieval depth
              <input
                type="number"
                min={1}
                max={100}
                value={topK}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) {
                    setTopK(Math.max(1, Math.min(100, n)));
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

      {(pending || results !== null || error) ? (
        <ActivityRail
          title="Search pipeline"
          steps={searchSteps({ pending, error, results, mode: submittedMode, topK })}
        />
      ) : null}

      {results !== null ? (
        <section className="flex flex-col gap-4">
          <ResultIntel
            title="Search summary"
            query={submittedQuery}
            items={results}
            mode={submittedMode}
          />
          {results.length === 0 ? (
            <div className="rounded-lg border border-line px-4 py-8 text-center text-sm text-muted">
              No matching chunks were returned for this query.
            </div>
          ) : null}
          <ResultPagination
            page={page}
            pageSize={RESULT_PAGE_SIZE}
            total={results.length}
            onPageChange={setPage}
          />
          <div className="flex flex-col gap-3">
            {visibleResults.map((hit, i) => (
              <EvidenceCard
                key={hit.chunk_id}
                item={hit}
                documentId={id}
                label={`#${(page - 1) * RESULT_PAGE_SIZE + i + 1}`}
              />
            ))}
          </div>
          <ResultPagination
            page={page}
            pageSize={RESULT_PAGE_SIZE}
            total={results.length}
            onPageChange={setPage}
          />
        </section>
      ) : null}
    </main>
  );
}
