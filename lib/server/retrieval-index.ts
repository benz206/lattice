import { embedderName } from "./embedding";
import {
  lexicalTokenizerVersion,
  tokenizeForLexicalSearch,
} from "./tokenization";
import type {
  ChunkRecord,
  RetrievalIndex,
  RetrievalIndexChunk,
  RetrievalIndexPosting,
} from "./types";

export const retrievalIndexVersion = 1;
export const chunkFormatVersion = 1;

function sortedRecord<T>(entries: Array<[string, T]>): Record<string, T> {
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function termFrequencies(tokens: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return sortedRecord([...counts.entries()]);
}

export function buildRetrievalIndex(
  documentId: string,
  chunks: ChunkRecord[],
): RetrievalIndex {
  const indexedChunks: RetrievalIndexChunk[] = chunks.map((chunk) => {
    const tokens = tokenizeForLexicalSearch(chunk.text);
    return {
      chunk_id: chunk.id,
      ordinal: chunk.ordinal,
      document_length: tokens.length,
      tokens,
      term_frequencies: termFrequencies(tokens),
    };
  });

  const documentFrequencies = new Map<string, number>();
  const postings = new Map<string, RetrievalIndexPosting[]>();

  for (const chunk of indexedChunks) {
    for (const [term, frequency] of Object.entries(chunk.term_frequencies)) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
      const termPostings = postings.get(term) ?? [];
      termPostings.push({
        chunk_id: chunk.chunk_id,
        ordinal: chunk.ordinal,
        term_frequency: frequency,
      });
      postings.set(term, termPostings);
    }
  }

  const totalDocumentLength = indexedChunks.reduce(
    (sum, chunk) => sum + chunk.document_length,
    0,
  );

  return {
    metadata: {
      version: retrievalIndexVersion,
      document_id: documentId,
      created_at: new Date().toISOString(),
      chunk_count: chunks.length,
      chunk_format_version: chunkFormatVersion,
      tokenizer: lexicalTokenizerVersion,
      embedder_model: embedderName(),
    },
    document_count: indexedChunks.length,
    average_document_length:
      indexedChunks.length > 0 ? totalDocumentLength / indexedChunks.length : 0,
    document_frequencies: sortedRecord([...documentFrequencies.entries()]),
    chunks: indexedChunks,
    inverted_index: sortedRecord(
      [...postings.entries()].map(([term, termPostings]) => [
        term,
        termPostings.sort((left, right) => left.ordinal - right.ordinal),
      ]),
    ),
  };
}

export function retrievalIndexMatchesChunks(
  index: RetrievalIndex,
  documentId: string,
  chunks: ChunkRecord[],
): boolean {
  return (
    index.metadata.version === retrievalIndexVersion &&
    index.metadata.chunk_format_version === chunkFormatVersion &&
    index.metadata.tokenizer === lexicalTokenizerVersion &&
    index.metadata.document_id === documentId &&
    index.metadata.chunk_count === chunks.length &&
    index.document_count === chunks.length
  );
}
