import { promises as fs } from "node:fs";
import path from "node:path";
import { embedTexts } from "./embedding";
import { buildDocumentMap, chunkPages, toChunkRecords } from "./chunking";
import { extractPages } from "./pdf";
import { buildRetrievalIndex } from "./retrieval-index";
import { settings } from "./settings";
import { withStore, writeChunks, writePages, writeRetrievalIndex } from "./store";
import type { DocumentRecord } from "./types";

function now(): string {
  return new Date().toISOString();
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

  void ingestDocument(id);
  return publicDocument(document);
}

export async function ingestDocument(documentId: string): Promise<void> {
  let document = await withStore(async (store) => store.getDocument(documentId));
  if (!document) return;

  document = { ...document, status: "processing", error: null, updated_at: now() };
  await withStore(async (store) => store.upsertDocument(document));

  try {
    const pages = await extractPages(document.storage_path);
    const chunkData = chunkPages(pages);
    const chunks = toChunkRecords(document.id, chunkData);
    const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
    chunks.forEach((chunk, index) => {
      chunk.embedding = embeddings[index] ?? [];
    });
    const documentMap = buildDocumentMap(chunkData);
    const retrievalIndex = buildRetrievalIndex(document.id, chunks);

    await Promise.all([
      writePages(document.id, pages),
      writeChunks(document.id, chunks),
      writeRetrievalIndex(document.id, retrievalIndex),
    ]);

    const ready: DocumentRecord = {
      ...document,
      num_pages: pages.length,
      status: "ready",
      updated_at: now(),
      error: null,
      document_map: documentMap,
    };
    await withStore(async (store) => store.upsertDocument(ready));
  } catch (error) {
    const failed: DocumentRecord = {
      ...document,
      status: "failed",
      updated_at: now(),
      error: error instanceof Error ? error.message : "Ingestion failed.",
    };
    await withStore(async (store) => store.upsertDocument(failed));
  }
}
