export type Status = "pending" | "processing" | "ready" | "failed";
export type SearchMode = "hybrid" | "vector" | "lexical";

export interface DocumentRecord {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  num_pages: number | null;
  status: Status;
  created_at: string;
  updated_at: string;
  error: string | null;
  storage_path: string;
  document_map: DocumentMapResponse | null;
}

export interface PageRecord {
  page_number: number;
  text: string;
  char_count: number;
}

export interface ChunkRecord {
  id: string;
  document_id: string;
  ordinal: number;
  text: string;
  page_start: number;
  page_end: number;
  char_start: number;
  char_end: number;
  section_title: string | null;
  overlap_prefix_len: number;
  summary: string | null;
  keywords: string[];
  embedding: number[];
}

export interface RetrievalIndexMetadata {
  version: number;
  document_id: string;
  created_at: string;
  chunk_count: number;
  chunk_format_version: number;
  tokenizer: string;
  embedder_model: string;
}

export interface RetrievalIndexChunk {
  chunk_id: string;
  ordinal: number;
  document_length: number;
  tokens: string[];
  term_frequencies: Record<string, number>;
}

export interface RetrievalIndexPosting {
  chunk_id: string;
  ordinal: number;
  term_frequency: number;
}

export interface RetrievalIndex {
  metadata: RetrievalIndexMetadata;
  document_count: number;
  average_document_length: number;
  document_frequencies: Record<string, number>;
  chunks: RetrievalIndexChunk[];
  inverted_index: Record<string, RetrievalIndexPosting[]>;
}

export interface DocumentMapSection {
  title: string | null;
  chunk_ordinal_start: number;
  chunk_ordinal_end: number;
  page_start: number;
  page_end: number;
  chunk_count: number;
}

export interface DocumentMapResponse {
  sections: DocumentMapSection[];
  num_chunks: number;
  num_pages: number;
}

export interface FusedHit {
  chunk_id: string;
  rrf_score: number;
  lexical_score: number | null;
  vector_score: number | null;
  metadata: {
    document_id: string;
    ordinal: number;
    page_start: number;
    page_end: number;
    section_title: string | null;
  };
  text: string;
}
