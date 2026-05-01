"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL, type DocumentOut, formatBytes } from "@/lib/api";
import { Spinner } from "./Spinner";

const MAX_WARN_BYTES = 200 * 1024 * 1024;

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; progress: number }
  | { phase: "error"; message: string };

function isPdf(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

export function UploadDropzone(): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [warning, setWarning] = useState<string | null>(null);

  const handleFile = useCallback((selected: File | null) => {
    setState({ phase: "idle" });
    setWarning(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!isPdf(selected)) {
      setFile(null);
      setState({ phase: "error", message: "Only PDF files are supported." });
      return;
    }
    if (selected.size > MAX_WARN_BYTES) {
      setWarning(
        `Large file (${formatBytes(selected.size)}). Upload may take a while.`,
      );
    }
    setFile(selected);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const dropped = e.dataTransfer.files?.[0] ?? null;
      handleFile(dropped);
    },
    [handleFile],
  );

  const upload = useCallback(() => {
    if (!file) return;
    setState({ phase: "uploading", progress: 0 });

    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/documents`);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setState({ phase: "uploading", progress: pct });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 202 || xhr.status === 200 || xhr.status === 201) {
        try {
          const parsed = JSON.parse(xhr.responseText) as DocumentOut;
          router.push(`/documents/${parsed.id}`);
          return;
        } catch {
          setState({
            phase: "error",
            message: "Upload succeeded but response was unreadable.",
          });
          return;
        }
      }
      let message = `Upload failed (${xhr.status}).`;
      if (xhr.status === 413) {
        message = "File too large. The server rejected this upload (413).";
      } else if (xhr.status === 415) {
        message = "Unsupported media type. Only PDF files are accepted (415).";
      } else {
        try {
          const body = JSON.parse(xhr.responseText) as { detail?: string };
          if (body.detail) {
            message = body.detail;
          }
        } catch {
          // ignore
        }
      }
      setState({ phase: "error", message });
    });

    xhr.addEventListener("error", () => {
      setState({ phase: "error", message: "Network error uploading file." });
    });

    xhr.addEventListener("abort", () => {
      setState({ phase: "error", message: "Upload was aborted." });
    });

    xhr.send(form);
  }, [file, router]);

  const uploading = state.phase === "uploading";

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor="upload-input"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${
          dragActive
            ? "border-[color:var(--accent)] bg-[color:var(--card)]"
            : "border-line hover:border-[color:var(--accent)]"
        }`}
      >
        <span className="text-base font-medium">Drop a PDF here</span>
        <span className="mt-1 text-sm text-muted">or click to choose a file</span>
        <input
          id="upload-input"
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          disabled={uploading}
        />
      </label>

      {file ? (
        <div className="flex items-center justify-between rounded-lg border border-line bg-[color:var(--card)] px-4 py-3 text-sm">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{file.name}</span>
            <span className="text-xs text-muted">{formatBytes(file.size)}</span>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => {
              setFile(null);
              setWarning(null);
              setState({ phase: "idle" });
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-md border border-line px-3 py-1 text-xs hover:bg-[color:var(--background)] disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      ) : null}

      {warning ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
          {warning}
        </div>
      ) : null}

      {state.phase === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {state.message}
        </div>
      ) : null}

      {uploading ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Spinner />
            <span>Uploading… {state.progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--card)]">
            <div
              className="h-full bg-[color:var(--accent)] transition-[width]"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={upload}
          disabled={!file || uploading}
          className="inline-flex items-center gap-2 rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)] disabled:opacity-50"
        >
          {uploading ? <Spinner size={14} /> : null}
          Upload and index
        </button>
        <span className="text-xs text-muted">PDF only. Up to ~200 MB recommended.</span>
      </div>
    </div>
  );
}
