import { promises as fs } from "node:fs";
import path from "node:path";
import { embedTexts } from "./embedding";
import { buildDocumentMap, chunkPages, summarizeChunk, toChunkRecords } from "./chunking";
import { extractPages } from "./pdf";
import { clearProgress, patchProgress, setProgress } from "./progress";
import { buildRetrievalIndex } from "./retrieval-index";
import { settings } from "./settings";
import { withStore, writeChunks, writePages, writeRetrievalIndex } from "./store";
import type { ChunkRecord, DocumentMapResponse, DocumentMapSection, DocumentRecord } from "./types";

const BYTES_PER_CHUNK_ESTIMATE = 2200;

function now(): string {
  return new Date().toISOString();
}

async function enrichDocumentMap(
  documentMap: DocumentMapResponse,
  chunks: ChunkRecord[],
  onBatch?: (done: number, total: number) => void,
): Promise<DocumentMapResponse> {
  const chunksByOrdinal = new Map(chunks.map((c) => [c.ordinal, c]));
  const summaries: string[] = [];

  for (const section of documentMap.sections) {
    const sectionChunks: ChunkRecord[] = [];
    for (let i = section.chunk_ordinal_start; i <= section.chunk_ordinal_end; i++) {
      const chunk = chunksByOrdinal.get(i);
      if (chunk) sectionChunks.push(chunk);
    }
    const joined = sectionChunks
      .map((c) => c.summary ?? "")
      .filter(Boolean)
      .join(" ");
    summaries.push(summarizeChunk(joined, 600));
  }

  const embeddings = await embedTexts(summaries, onBatch);

  const enriched: DocumentMapSection[] = documentMap.sections.map((section, i) => {
    const sectionChunks: ChunkRecord[] = [];
    for (let j = section.chunk_ordinal_start; j <= section.chunk_ordinal_end; j++) {
      const chunk = chunksByOrdinal.get(j);
      if (chunk) sectionChunks.push(chunk);
    }
    const allKeywords = sectionChunks.flatMap((c) => c.keywords);
    const seen = new Set<string>();
    const dedupedKeywords: string[] = [];
    for (const kw of allKeywords) {
      if (!seen.has(kw)) {
        seen.add(kw);
        dedupedKeywords.push(kw);
      }
      if (dedupedKeywords.length === 10) break;
    }
    return {
      ...section,
      summary: summaries[i] ?? "",
      summary_embedding: embeddings[i] ?? [],
      keywords: dedupedKeywords,
    };
  });

  return { ...documentMap, sections: enriched };
}

function publicDocument(document: DocumentRecord) {
  return {
    id: document.id,
    filename: document.filename,
    content_type: document.content_type,
    size_bytes: document.size_bytes,
    num_pages: document.num_pages,
    status: document.status,
    created_at: document.created_at,
    updated_at: document.updated_at,
    error: document.error,
  };
}

export async function createUpload(file: File): Promise<ReturnType<typeof publicDocument>> {
  const contentType = file.type || "application/pdf";
  if (contentType !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF uploads are accepted.");
  }
  const maxBytes = settings.maxUploadMb * 1024 * 1024;
  if (file.size > maxBytes) {
    const error = new Error(`File exceeds max upload size of ${settings.maxUploadMb} MB.`);
    error.name = "PayloadTooLarge";
    throw error;
  }

  await fs.mkdir(settings.uploadDir, { recursive: true });
  const id = crypto.randomUUID();
  const storagePath = path.join(settings.uploadDir, `${id}.pdf`);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storagePath, bytes);

  const document: DocumentRecord = {
    id,
    filename: file.name || `${id}.pdf`,
    content_type: contentType,
    size_bytes: file.size,
    num_pages: null,
    status: "pending",
    created_at: now(),
    updated_at: now(),
    error: null,
    storage_path: storagePath,
    document_map: null,
  };

  await withStore(async (store) => {
    store.upsertDocument(document);
  });

  const estimatedChunks = Math.max(
    1,
    Math.round(file.size / BYTES_PER_CHUNK_ESTIMATE),
  );
  setProgress(id, {
    phase: "queued",
    total: estimatedChunks,
    estimated: true,
    message: "Queued for ingestion",
  });

  void ingestDocument(id);
  return publicDocument(document);
}

export async function ingestDocument(documentId: string): Promise<void> {
  let document = await withStore(async (store) => store.getDocument(documentId));
  if (!document) return;

  document = { ...document, status: "processing", error: null, updated_at: now() };
  await withStore(async (store) => store.upsertDocument(document));

  const estimatedChunksFromBytes = Math.max(
    1,
    Math.round(document.size_bytes / BYTES_PER_CHUNK_ESTIMATE),
  );

  try {
    setProgress(documentId, {
      phase: "extracting",
      total: estimatedChunksFromBytes,
      estimated: true,
      message: "Extracting text from PDF",
    });
    const pages = await extractPages(document.storage_path);

    const estimatedChunksFromPages = Math.max(
      estimatedChunksFromBytes,
      pages.length * 3,
    );
    setProgress(documentId, {
      phase: "chunking",
      total: estimatedChunksFromPages,
      estimated: true,
      message: `Segmenting ${pages.length} ${pages.length === 1 ? "page" : "pages"} into chunks`,
    });
    const chunkData = chunkPages(pages);
    const chunks = toChunkRecords(document.id, chunkData);

    setProgress(documentId, {
      phase: "embedding_chunks",
      current: 0,
      total: Math.max(1, chunks.length),
      estimated: false,
      message: `Embedding ${chunks.length} ${chunks.length === 1 ? "chunk" : "chunks"}`,
    });
    const embeddings = await embedTexts(
      chunks.map((chunk) => chunk.text),
      (done, total) => {
        patchProgress(documentId, { current: done, total });
      },
    );
    chunks.forEach((chunk, index) => {
      chunk.embedding = embeddings[index] ?? [];
    });

    const rawDocumentMap = buildDocumentMap(chunkData);
    const sectionCount = rawDocumentMap.sections.length;
    setProgress(documentId, {
      phase: "summarizing_sections",
      current: 0,
      total: Math.max(1, sectionCount),
      estimated: false,
      message: `Embedding ${sectionCount} section ${sectionCount === 1 ? "summary" : "summaries"}`,
    });
    const documentMap = await enrichDocumentMap(rawDocumentMap, chunks, (done, total) => {
      patchProgress(documentId, { current: done, total });
    });

    setProgress(documentId, {
      phase: "indexing",
      current: 0,
      total: 1,
      estimated: false,
      message: "Building retrieval index",
    });
    const retrievalIndex = buildRetrievalIndex(document.id, chunks);
    patchProgress(documentId, { current: 1 });

    setProgress(documentId, {
      phase: "finalizing",
      current: 0,
      total: 1,
      estimated: false,
      message: "Writing chunks and index to disk",
    });
    await Promise.all([
      writePages(document.id, pages),
      writeChunks(document.id, chunks),
      writeRetrievalIndex(document.id, retrievalIndex),
    ]);
    patchProgress(documentId, { current: 1 });

    const ready: DocumentRecord = {
      ...document,
      num_pages: pages.length,
      status: "ready",
      updated_at: now(),
      error: null,
      document_map: documentMap,
    };
    await withStore(async (store) => store.upsertDocument(ready));
    clearProgress(documentId);
  } catch (error) {
    const failed: DocumentRecord = {
      ...document,
      status: "failed",
      updated_at: now(),
      error: error instanceof Error ? error.message : "Ingestion failed.",
    };
    await withStore(async (store) => store.upsertDocument(failed));
    clearProgress(documentId);
  }
}
