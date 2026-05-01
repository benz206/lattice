import { cosine, embedTexts } from "./embedding";
import { readChunks } from "./store";
import type { ChunkRecord, FusedHit, SearchMode } from "./types";

const tokenRe = /\w+/gu;
const stopwords = new Set([
  "the", "and", "for", "that", "with", "this", "are", "was", "but", "not",
  "you", "your", "all", "any", "can", "had", "has", "have", "from", "they",
  "their", "them", "there", "these", "those", "then", "than", "which", "who",
  "what", "when", "where", "why", "how", "will", "would", "could", "should",
  "may", "might", "must", "been", "being", "were", "into", "onto", "out",
  "off", "over", "under", "again", "further", "about", "above", "below",
  "because", "before", "after", "between", "during", "through", "while",
  "same", "some", "such", "each", "every", "few", "more", "most", "other",
  "own", "only", "very", "also", "just", "thus", "upon",
]);

function tokenize(text: string): string[] {
  return [...text.toLowerCase().matchAll(tokenRe)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

function toHit(chunk: ChunkRecord, score: number): FusedHit {
  return {
    chunk_id: chunk.id,
    rrf_score: score,
    lexical_score: null,
    vector_score: null,
    metadata: {
      document_id: chunk.document_id,
      ordinal: chunk.ordinal,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      section_title: chunk.section_title,
    },
    text: chunk.text,
  };
}

async function vectorSearch(
  query: string,
  chunks: ChunkRecord[],
  topK: number,
): Promise<FusedHit[]> {
  const [queryVector] = await embedTexts([query]);
  if (!queryVector) return [];
  return chunks
    .filter((chunk) => chunk.embedding.length)
    .map((chunk) => ({ chunk, score: cosine(queryVector, chunk.embedding) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK))
    .map(({ chunk, score }) => ({ ...toHit(chunk, score), vector_score: score }));
}

function lexicalSearch(query: string, chunks: ChunkRecord[], topK: number): FusedHit[] {
  const queryTokens = tokenize(query);
  if (!queryTokens.length || !chunks.length) return [];
  const docs = chunks.map((chunk) => tokenize(chunk.text));
  const avgDl = docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1);
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const k1 = 1.5;
  const b = 0.75;
  return chunks
    .map((chunk, index) => {
      const doc = docs[index] ?? [];
      const tf = new Map<string, number>();
      for (const token of doc) tf.set(token, (tf.get(token) ?? 0) + 1);
      let score = 0;
      for (const token of queryTokens) {
        const freq = tf.get(token) ?? 0;
        if (!freq) continue;
        const idf = Math.log(1 + (chunks.length - (df.get(token) ?? 0) + 0.5) / ((df.get(token) ?? 0) + 0.5));
        score += idf * ((freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (doc.length / avgDl))));
      }
      return { chunk, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK))
    .map(({ chunk, score }) => ({ ...toHit(chunk, score), lexical_score: score }));
}

function weightedRrf(vectorIds: string[], lexicalIds: string[], alpha = 0.5): Map<string, number> {
  const fused = new Map<string, number>();
  vectorIds.forEach((id, rank) => {
    fused.set(id, (fused.get(id) ?? 0) + alpha * (1 / (60 + rank + 1)));
  });
  lexicalIds.forEach((id, rank) => {
    fused.set(id, (fused.get(id) ?? 0) + (1 - alpha) * (1 / (60 + rank + 1)));
  });
  return fused;
}

export async function searchChunks({
  query,
  mode,
  topK = 20,
  documentId,
}: {
  query: string;
  mode: SearchMode;
  topK?: number;
  documentId?: string | null;
}): Promise<FusedHit[]> {
  if (!query.trim()) return [];
  const chunks = (await readChunks(documentId ?? undefined)).filter((chunk) =>
    documentId ? chunk.document_id === documentId : true,
  );
  if (mode === "vector") return vectorSearch(query, chunks, topK);
  if (mode === "lexical") return lexicalSearch(query, chunks, topK);

  const [vectorHits, lexicalHits] = await Promise.all([
    vectorSearch(query, chunks, Math.max(40, topK)),
    Promise.resolve(lexicalSearch(query, chunks, Math.max(40, topK))),
  ]);
  const fused = weightedRrf(
    vectorHits.map((hit) => hit.chunk_id),
    lexicalHits.map((hit) => hit.chunk_id),
  );
  const byId = new Map<string, FusedHit>();
  for (const hit of vectorHits) byId.set(hit.chunk_id, hit);
  for (const hit of lexicalHits) {
    const current = byId.get(hit.chunk_id);
    byId.set(hit.chunk_id, {
      ...(current ?? hit),
      lexical_score: hit.lexical_score,
      text: current?.text || hit.text,
    });
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, topK))
    .map(([id, score]) => ({ ...byId.get(id)!, rrf_score: score }));
}
