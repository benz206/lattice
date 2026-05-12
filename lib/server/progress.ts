import type { IngestionPhase, IngestionProgress } from "./types";

const phaseLabels: Record<IngestionPhase, string> = {
  queued: "Queued",
  extracting: "Extracting text",
  chunking: "Segmenting into chunks",
  embedding_chunks: "Embedding chunks",
  summarizing_sections: "Embedding section summaries",
  indexing: "Building retrieval index",
  finalizing: "Saving",
};

const store = new Map<string, IngestionProgress>();

interface SetArgs {
  phase: IngestionPhase;
  current?: number;
  total?: number;
  estimated?: boolean;
  message?: string;
}

export function setProgress(documentId: string, args: SetArgs): void {
  store.set(documentId, {
    phase: args.phase,
    phase_label: phaseLabels[args.phase],
    current: args.current ?? 0,
    total: args.total ?? 0,
    estimated: args.estimated ?? false,
    message: args.message ?? phaseLabels[args.phase],
    updated_at: new Date().toISOString(),
  });
}

export function patchProgress(
  documentId: string,
  patch: Partial<Omit<IngestionProgress, "updated_at" | "phase_label">>,
): void {
  const prev = store.get(documentId);
  if (!prev) return;
  store.set(documentId, {
    ...prev,
    ...patch,
    phase_label: patch.phase ? phaseLabels[patch.phase] : prev.phase_label,
    updated_at: new Date().toISOString(),
  });
}

export function getProgress(documentId: string): IngestionProgress | null {
  return store.get(documentId) ?? null;
}

export function clearProgress(documentId: string): void {
  store.delete(documentId);
}
