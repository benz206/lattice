import { promises as fs } from "node:fs";
import path from "node:path";
import { settings } from "./settings";
import type {
  ChunkRecord,
  DocumentRecord,
  PageRecord,
  RetrievalIndex,
} from "./types";

interface DbShape {
  documents: DocumentRecord[];
}

const dbPath = path.join(settings.dataDir, "lattice.json");
let queue: Promise<unknown> = Promise.resolve();

async function ensureStore(): Promise<void> {
  await fs.mkdir(settings.dataDir, { recursive: true });
  await fs.mkdir(settings.uploadDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    await fs.writeFile(dbPath, JSON.stringify({ documents: [] }, null, 2));
  }
}

async function readDb(): Promise<DbShape> {
  await ensureStore();
  const raw = await fs.readFile(dbPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<DbShape>;
  return { documents: Array.isArray(parsed.documents) ? parsed.documents : [] };
}

async function writeDb(db: DbShape): Promise<void> {
  await ensureStore();
  const tmp = `${dbPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, dbPath);
}

export async function withStore<T>(
  fn: (store: StoreSession) => Promise<T>,
): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const session = new StoreSession(db);
    const result = await fn(session);
    if (session.dirty) {
      await writeDb(db);
    }
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export class StoreSession {
  dirty = false;

  constructor(private readonly db: DbShape) {}

  listDocuments(): DocumentRecord[] {
    return [...this.db.documents].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }

  getDocument(id: string): DocumentRecord | null {
    return this.db.documents.find((doc) => doc.id === id) ?? null;
  }

  upsertDocument(document: DocumentRecord): void {
    const index = this.db.documents.findIndex((doc) => doc.id === document.id);
    if (index === -1) {
      this.db.documents.push(document);
    } else {
      this.db.documents[index] = document;
    }
    this.dirty = true;
  }

  deleteDocument(id: string): DocumentRecord | null {
    const index = this.db.documents.findIndex((doc) => doc.id === id);
    if (index === -1) return null;
    const [removed] = this.db.documents.splice(index, 1);
    this.dirty = true;
    return removed ?? null;
  }
}

function pagesPath(documentId: string): string {
  return path.join(settings.dataDir, "pages", `${documentId}.json`);
}

function chunksPath(documentId: string): string {
  return path.join(settings.dataDir, "chunks", `${documentId}.json`);
}

export function retrievalIndexPath(documentId: string): string {
  return path.join(settings.dataDir, "indexes", `${documentId}.json`);
}

export async function readPages(documentId: string): Promise<PageRecord[]> {
  try {
    const raw = await fs.readFile(pagesPath(documentId), "utf8");
    const pages = JSON.parse(raw) as PageRecord[];
    return Array.isArray(pages) ? pages : [];
  } catch {
    return [];
  }
}

export async function writePages(
  documentId: string,
  pages: PageRecord[],
): Promise<void> {
  await fs.mkdir(path.dirname(pagesPath(documentId)), { recursive: true });
  await fs.writeFile(pagesPath(documentId), JSON.stringify(pages, null, 2));
}

export async function readChunks(documentId?: string): Promise<ChunkRecord[]> {
  if (documentId) {
    try {
      const raw = await fs.readFile(chunksPath(documentId), "utf8");
      const chunks = JSON.parse(raw) as ChunkRecord[];
      return Array.isArray(chunks) ? chunks : [];
    } catch {
      return [];
    }
  }
  try {
    const dir = path.join(settings.dataDir, "chunks");
    const names = await fs.readdir(dir);
    const all = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) =>
          fs
            .readFile(path.join(dir, name), "utf8")
            .then((raw) => JSON.parse(raw) as ChunkRecord[])
            .catch(() => []),
        ),
    );
    return all.flat();
  } catch {
    return [];
  }
}

export async function writeChunks(
  documentId: string,
  chunks: ChunkRecord[],
): Promise<void> {
  await fs.mkdir(path.dirname(chunksPath(documentId)), { recursive: true });
  await fs.writeFile(chunksPath(documentId), JSON.stringify(chunks, null, 2));
}

export async function readRetrievalIndex(
  documentId: string,
): Promise<RetrievalIndex | null> {
  try {
    const raw = await fs.readFile(retrievalIndexPath(documentId), "utf8");
    return JSON.parse(raw) as RetrievalIndex;
  } catch {
    return null;
  }
}

export async function writeRetrievalIndex(
  documentId: string,
  index: RetrievalIndex,
): Promise<void> {
  const filePath = retrievalIndexPath(documentId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2));
}

export async function deleteRetrievalIndex(documentId: string): Promise<void> {
  await fs.unlink(retrievalIndexPath(documentId)).catch(() => undefined);
}

export async function deleteDocumentFiles(document: DocumentRecord): Promise<void> {
  await Promise.allSettled([
    fs.unlink(document.storage_path),
    fs.unlink(pagesPath(document.id)),
    fs.unlink(chunksPath(document.id)),
    deleteRetrievalIndex(document.id),
  ]);
}
