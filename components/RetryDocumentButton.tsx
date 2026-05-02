"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { retryDocument } from "@/lib/api";
import { Spinner } from "./Spinner";

interface RetryDocumentButtonProps {
  documentId: string;
}

export function RetryDocumentButton({
  documentId,
}: RetryDocumentButtonProps): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setPending(true);
    setError(null);
    try {
      await retryDocument(documentId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-[color:var(--card)] disabled:opacity-50"
      >
        {pending ? <Spinner size={14} /> : null}
        Retry ingestion
      </button>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
