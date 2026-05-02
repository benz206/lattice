"use client";

import { useCallback, useEffect, useState } from "react";
import { listChunks, type ChunkOut } from "@/lib/api";
import { ResultPagination } from "./ResultPagination";
import { Spinner } from "./Spinner";

interface ChunksPanelProps {
  documentId: string;
  totalChunks: number;
}

const PAGE_SIZE = 25;

export function ChunksPanel({
  documentId,
  totalChunks,
}: ChunksPanelProps): React.JSX.Element {
  const [chunks, setChunks] = useState<ChunkOut[]>([]);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const start = (nextPage - 1) * PAGE_SIZE;
        const batch = await listChunks(documentId, {
          limit: PAGE_SIZE,
          offset: start,
        });
        setChunks(batch);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load chunks");
      } finally {
        setLoading(false);
      }
    },
    [documentId],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  useEffect(() => {
    setPage(1);
  }, [documentId]);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          Page {page} · {chunks.length} visible · {totalChunks} total chunks
        </span>
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Spinner size={12} /> loading
          </span>
        ) : null}
      </div>

      <ResultPagination
        ariaLabel="Chunks pagination"
        itemLabel="chunks"
        page={page}
        pageSize={PAGE_SIZE}
        total={totalChunks}
        onPageChange={setPage}
      />

      <div className="flex flex-col gap-3">
        {chunks.map((c) => (
          <article
            key={c.id}
            id={`chunk-${c.ordinal}`}
            className="scroll-target surface-card rounded-lg border p-4"
          >
            <header className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-sm bg-[color:var(--accent)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[color:var(--accent-contrast)]">
                #{c.ordinal}
              </span>
              {c.section_title ? (
                <span className="font-medium">{c.section_title}</span>
              ) : (
                <span className="text-muted">Untitled section</span>
              )}
              <span className="text-muted">
                ·{" "}
                {c.page_start === c.page_end
                  ? `p. ${c.page_start}`
                  : `pp. ${c.page_start}–${c.page_end}`}
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted">
                {c.char_end - c.char_start} chars
              </span>
            </header>
            {c.summary ? (
              <p className="mt-2 text-sm text-muted">{c.summary}</p>
            ) : null}
            {c.keywords.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {c.keywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted"
                  >
                    {k}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mt-3 whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
              {c.text}
            </p>
          </article>
        ))}
      </div>

      <ResultPagination
        ariaLabel="Chunks pagination"
        itemLabel="chunks"
        page={page}
        pageSize={PAGE_SIZE}
        total={totalChunks}
        onPageChange={setPage}
      />
    </div>
  );
}
