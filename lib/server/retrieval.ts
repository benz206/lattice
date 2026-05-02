import { cosine, embedTexts } from "./embedding";
import { expandQuery } from "./query-expansion";
import { rerankAndDiversifyHits } from "./reranking";
import { buildRetrievalIndex, retrievalIndexMatchesChunks } from "./retrieval-index";
import { readChunks, readRetrievalIndex } from "./store";
import { createTimer, timingMap, type TimingSample } from "./timing";
import { tokenizeForLexicalSearch } from "./tokenization";
import type { ChunkRecord, FusedHit, RetrievalIndex, SearchMode } from "./types";

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

async function loadRetrievalIndex(
  documentId: string | null | undefined,
  chunks: ChunkRecord[],
): Promise<RetrievalIndex> {
  if (documentId) {
    const stored = await readRetrievalIndex(documentId);
    if (stored && retrievalIndexMatchesChunks(stored, documentId, chunks)) {
      return stored;
    }
  }
  return buildRetrievalIndex(documentId ?? "__all__", chunks);
}

function lexicalSearch(
  query: string,
  chunks: ChunkRecord[],
  index: RetrievalIndex,
  topK: number,
): FusedHit[] {
  if (!chunks.length || !index.document_count) return [];
  const expanded = expandQuery(query, {
    includeQuotedPhrase: false,
    maxVariants: 8,
  });
  const variants = expanded.variants.length
    ? expanded.variants
    : [{ query, kind: "normalized" as const, weight: 1 }];
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const chunkStats = new Map(index.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  const scores = new Map<string, number>();
  const k1 = 1.5;
  const b = 0.75;

  for (const variant of variants) {
    const queryTokens = [...new Set(tokenizeForLexicalSearch(variant.query))];
    for (const token of queryTokens) {
      const postings = index.inverted_index[token] ?? [];
      const df = index.document_frequencies[token] ?? 0;
      if (!postings.length || !df) continue;
      const idf = Math.log(
        1 + (index.document_count - df + 0.5) / (df + 0.5),
      );
      for (const posting of postings) {
        const chunk = byId.get(posting.chunk_id);
        const stats = chunkStats.get(posting.chunk_id);
        if (!chunk || !stats) continue;
        const denominator =
          posting.term_frequency +
          k1 *
            (1 -
              b +
              b *
                (stats.document_length /
                  (index.average_document_length || 1)));
        const bm25 =
          idf * ((posting.term_frequency * (k1 + 1)) / denominator);
        scores.set(
          posting.chunk_id,
          (scores.get(posting.chunk_id) ?? 0) + bm25 * variant.weight,
        );
      }
    }
  }

  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunk: byId.get(chunkId), score }))
    .filter(
      (row): row is { chunk: ChunkRecord; score: number } =>
        Boolean(row.chunk) && row.score > 0,
    )
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

export interface SearchChunksMeta {
  mode: SearchMode;
  requested_top_k: number;
  chunk_count: number;
  hit_count: number;
  timings: TimingSample[];
  timing_ms: Record<string, number>;
}

export interface SearchChunksResult {
  hits: FusedHit[];
  meta: SearchChunksMeta;
}

export async function searchChunksWithMeta({
  query,
  mode,
  topK = 20,
  documentId,
}: {
  query: string;
  mode: SearchMode;
  topK?: number;
  documentId?: string | null;
}): Promise<SearchChunksResult> {
  const timer = createTimer();
  let hits: FusedHit[] = [];
  let chunkCount = 0;

  if (!query.trim()) {
    const timings = [timer.total("search_total")];
    return {
      hits,
      meta: {
        mode,
        requested_top_k: topK,
        chunk_count: chunkCount,
        hit_count: hits.length,
        timings,
        timing_ms: timingMap(timings),
      },
    };
  }

  const loadedChunks = await timer.asyncPhase("load_chunks", () =>
    readChunks(documentId ?? undefined),
  );
  const chunks = timer.syncPhase("filter_chunks", () =>
    loadedChunks.filter((chunk) => (documentId ? chunk.document_id === documentId : true)),
  );
  chunkCount = chunks.length;

  if (mode === "vector") {
    hits = await timer.asyncPhase("vector_search", () => vectorSearch(query, chunks, topK));
  } else if (mode === "lexical") {
    const retrievalIndex = await timer.asyncPhase("load_retrieval_index", () =>
      loadRetrievalIndex(documentId, chunks),
    );
    const lexicalHits = timer.syncPhase("lexical_search", () =>
      lexicalSearch(query, chunks, retrievalIndex, Math.max(40, topK)),
    );
    hits = timer.syncPhase("rerank_results", () =>
      rerankAndDiversifyHits(lexicalHits, query, { topK }),
    );
  } else {
    const retrievalIndex = await timer.asyncPhase("load_retrieval_index", () =>
      loadRetrievalIndex(documentId, chunks),
    );
    const [vectorHits, lexicalHits] = await Promise.all([
      timer.asyncPhase("vector_search", () => vectorSearch(query, chunks, Math.max(40, topK))),
      Promise.resolve(
        timer.syncPhase("lexical_search", () =>
          lexicalSearch(query, chunks, retrievalIndex, Math.max(40, topK)),
        ),
      ),
    ]);

    const fusedHits = timer.syncPhase("fuse_results", () => {
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
        .map(([id, score]) => ({ ...byId.get(id)!, rrf_score: score }));
    });
    hits = timer.syncPhase("rerank_results", () =>
      rerankAndDiversifyHits(fusedHits, query, { topK }),
    );
  }

  const timings = [...timer.samples(), timer.total("search_total")];
  return {
    hits,
    meta: {
      mode,
      requested_top_k: topK,
      chunk_count: chunkCount,
      hit_count: hits.length,
      timings,
      timing_ms: timingMap(timings),
    },
  };
}

export async function searchChunks(args: {
  query: string;
  mode: SearchMode;
  topK?: number;
  documentId?: string | null;
}): Promise<FusedHit[]> {
  return (await searchChunksWithMeta(args)).hits;
}
