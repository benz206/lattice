export const API_BASE_URL = "";

export type Status = "pending" | "processing" | "ready" | "failed";
export type SearchMode = "hybrid" | "vector" | "lexical";

export interface DocumentOut {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  num_pages: number | null;
  status: Status;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface PageOut {
  page_number: number;
  char_count: number;
  preview: string;
}

export interface PageFull {
  page_number: number;
  char_count: number;
  text: string;
}

export interface DocumentDetail extends DocumentOut {
  pages: PageOut[];
  num_chunks: number;
}

export interface DocumentStatusResponse {
  id: string;
  status: Status;
  num_pages: number | null;
  error: string | null;
}

export interface ChunkOut {
  id: string;
  ordinal: number;
  text: string;
  page_start: number;
  page_end: number;
  char_start: number;
  char_end: number;
  section_title: string | null;
  summary: string | null;
  keywords: string[];
}

export interface Section {
  title: string;
  chunk_ordinal_start: number;
  chunk_ordinal_end: number;
  page_start: number;
  page_end: number;
  chunk_count: number;
}

export interface DocumentMapResponse {
  sections: Section[];
  num_chunks: number;
  num_pages: number;
}

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  top_k?: number;
  document_id?: string | null;
}

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  page_start: number;
  page_end: number;
  section_title: string | null;
  text: string;
  score_hybrid: number;
  score_vector: number | null;
  score_lexical: number | null;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  results: SearchHit[];
}

export interface AnswerRequest {
  query: string;
  top_k?: number;
  document_id?: string | null;
}

export interface Citation {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  page_start: number;
  page_end: number;
  section_title: string | null;
}

export interface Evidence {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  page_start: number;
  page_end: number;
  section_title: string | null;
  text: string;
  score: number;
}

export interface RetrievalMeta {
  hit_count: number;
  max_score: number;
  alpha: number;
  top_k: number;
  model: string;
  [key: string]: unknown;
}

export interface AnswerResponse {
  query: string;
  answer: string;
  citations: Citation[];
  evidence: Evidence[];
  insufficient: boolean;
  confidence: number;
  answer_score: number;
  retrieval_meta: RetrievalMeta;
}

export interface HealthResponse {
  status: string;
  version: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function resolveUrl(path: string): Promise<string> {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (typeof window !== "undefined") return `${API_BASE_URL}${path}`;
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("host") ?? `localhost:${process.env.PORT ?? 3000}`;
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}${path}`;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = await resolveUrl(path);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  const hasBody = init?.body !== undefined && init.body !== null;
  const isFormData =
    typeof FormData !== "undefined" && hasBody && init.body instanceof FormData;
  if (hasBody && !isFormData && !("Content-Type" in headers)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers,
  });

  if (!response.ok) {
    let detail: unknown = null;
    try {
      detail = await response.json();
    } catch {
      // ignore
    }
    let message = `Request failed: ${response.status} ${response.statusText}`;
    if (detail && typeof detail === "object") {
      const detailField = (detail as Record<string, unknown>).detail;
      if (typeof detailField === "string" && detailField.length > 0) {
        message = detailField;
      }
    }
    throw new ApiError(response.status, message, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function listDocuments(): Promise<DocumentOut[]> {
  return fetchJson<DocumentOut[]>("/api/documents");
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return fetchJson<DocumentDetail>(`/api/documents/${encodeURIComponent(id)}`);
}

export function getDocumentMap(id: string): Promise<DocumentMapResponse> {
  return fetchJson<DocumentMapResponse>(`/api/documents/${encodeURIComponent(id)}/map`);
}

export function getPage(id: string, pageNumber: number): Promise<PageFull> {
  return fetchJson<PageFull>(
    `/api/documents/${encodeURIComponent(id)}/pages/${pageNumber}`,
  );
}

export interface ListChunksOptions {
  limit?: number;
  offset?: number;
}

export function listChunks(
  id: string,
  opts: ListChunksOptions = {},
): Promise<ChunkOut[]> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) {
    params.set("limit", String(opts.limit));
  }
  if (opts.offset !== undefined) {
    params.set("offset", String(opts.offset));
  }
  const qs = params.toString();
  const suffix = qs ? `?${qs}` : "";
  return fetchJson<ChunkOut[]>(
    `/api/documents/${encodeURIComponent(id)}/chunks${suffix}`,
  );
}

export function deleteDocument(id: string): Promise<void> {
  return fetchJson<void>(`/api/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function pollStatus(id: string): Promise<DocumentStatusResponse> {
  return fetchJson<DocumentStatusResponse>(
    `/api/documents/${encodeURIComponent(id)}/status`,
  );
}

export function retryDocument(id: string): Promise<DocumentStatusResponse> {
  return fetchJson<DocumentStatusResponse>(
    `/api/documents/${encodeURIComponent(id)}/retry`,
    { method: "POST" },
  );
}

export function search(req: SearchRequest): Promise<SearchResponse> {
  return fetchJson<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function answer(req: AnswerRequest): Promise<AnswerResponse> {
  return fetchJson<AnswerResponse>("/api/answer", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/api/health");
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0 B";
  }
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[unit]}`;
}

export function formatDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return s;
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
