"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pollStatus, type Status } from "@/lib/api";
import { Spinner } from "./Spinner";
import { StatusBadge } from "./StatusBadge";

interface IngestionProgressProps {
  documentId: string;
  initialStatus: Status;
  initialNumPages: number | null;
  initialError: string | null;
}

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

  useEffect(() => {
    if (status === "ready" || status === "failed") {
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await pollStatus(documentId);
        if (cancelled) return;
        setStatus(res.status);
        setNumPages(res.num_pages);
        setError(res.error);
        if (res.status === "ready" || res.status === "failed") {
          router.refresh();
        }
      } catch {
        // keep polling
      }
    };

    const id = window.setInterval(tick, 1500);
    // Kick off one immediate tick
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [documentId, status, router]);

  if (status === "ready") {
    return null;
  }

  return (
    <section className="surface-card flex flex-col gap-3 rounded-lg border p-5">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {status === "processing" || status === "pending" ? <Spinner /> : null}
        <span className="text-sm font-medium">
          {status === "pending"
            ? "Queued for ingestion"
            : status === "processing"
              ? "Processing document"
              : status === "failed"
                ? "Ingestion failed"
                : ""}
        </span>
        {numPages !== null ? (
          <span className="text-xs text-muted">{numPages} pages detected</span>
        ) : null}
      </div>
      {status === "failed" && error ? (
        <pre className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </pre>
      ) : (
        <p className="text-xs text-muted">
          This page polls every 1.5 seconds and will refresh automatically when
          ingestion finishes.
        </p>
      )}
    </section>
  );
}
