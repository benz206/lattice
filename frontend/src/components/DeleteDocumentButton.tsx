"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteDocument } from "@/lib/api";
import { Spinner } from "./Spinner";

interface DeleteDocumentButtonProps {
  documentId: string;
  filename: string;
}

export function DeleteDocumentButton({
  documentId,
  filename,
}: DeleteDocumentButtonProps): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    const ok = window.confirm(
      `Delete "${filename}"? This removes its chunks and embeddings and cannot be undone.`,
    );
    if (!ok) return;
    setPending(true);
    setError(null);
    try {
      await deleteDocument(documentId);
      router.push("/documents");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
      >
        {pending ? <Spinner size={14} /> : null}
        Delete
      </button>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
