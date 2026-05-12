"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pollStatus, type IngestionProgress as Progress, type Status } from "@/lib/api";
import { Spinner } from "./Spinner";
import { StatusBadge } from "./StatusBadge";

interface IngestionProgressProps {
  documentId: string;
  initialStatus: Status;
  initialNumPages: number | null;
  initialError: string | null;
}

const FAST_INTERVAL_MS = 600;
const SLOW_INTERVAL_MS = 1500;

export function IngestionProgress({
  documentId,
  initialStatus,
  initialNumPages,
  initialError,
}: IngestionProgressProps): React.JSX.Element | null {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [numPages, setNumPages] = useState<number | null>(initialNumPages);
  const [error, setError] = useState<string | null>(initialError);
  const [progress, setProgress] = useState<Progress | null>(null);
  const cancelledRef = useRef<boolean>(false);

  useEffect(() => {
    if (status === "ready" || status === "failed") return;
    cancelledRef.current = false;
    let timeout: number | null = null;

    const tick = async () => {
      try {
        const res = await pollStatus(documentId);
        if (cancelledRef.current) return;
        setStatus(res.status);
        setNumPages(res.num_pages);
        setError(res.error);
        setProgress(res.progress);
        if (res.status === "ready" || res.status === "failed") {
          router.refresh();
          return;
        }
        const interval =
          res.progress && res.progress.phase === "embedding_chunks"
            ? FAST_INTERVAL_MS
            : SLOW_INTERVAL_MS;
        timeout = window.setTimeout(tick, interval);
      } catch {
        if (!cancelledRef.current) {
          timeout = window.setTimeout(tick, SLOW_INTERVAL_MS);
        }
      }
    };

    void tick();
    return () => {
      cancelledRef.current = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [documentId, status, router]);

  if (status === "ready") {
    return null;
  }

  const determinate = progress !== null && progress.total > 0;
  const pct = determinate
    ? Math.min(100, Math.round((progress!.current / progress!.total) * 100))
    : 0;

  const headline =
    status === "failed"
      ? "Ingestion failed"
      : progress
        ? progress.message
        : status === "pending"
          ? "Queued for ingestion"
          : "Processing document";

  return (
    <section className="surface-card flex flex-col gap-3 rounded-lg border p-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {status === "processing" || status === "pending" ? <Spinner /> : null}
        <span className="text-sm font-medium">{headline}</span>
        {progress ? (
          <span className="ml-auto text-xs tabular-nums text-muted">
            {progress.estimated ? "~" : ""}
            {progress.current.toLocaleString()} /{" "}
            {progress.total.toLocaleString()}
            {determinate ? ` · ${pct}%` : ""}
          </span>
        ) : null}
      </div>

      {status !== "failed" ? (
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-[color:var(--card)]">
          {determinate ? (
            <div
              className="h-full bg-[color:var(--accent)] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="absolute inset-0 lattice-indeterminate-bar" />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        {progress ? (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono uppercase tracking-wide">
            {progress.phase.replace(/_/g, " ")}
          </span>
        ) : null}
        {numPages !== null ? <span>{numPages} pages detected</span> : null}
        {progress?.estimated ? (
          <span className="text-muted">estimated count — refines as ingestion proceeds</span>
        ) : null}
      </div>

      {status === "failed" && error ? (
        <pre className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </pre>
      ) : null}
    </section>
  );
}
