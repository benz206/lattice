import type { FusedHit } from "./types";

export interface RerankOptions {
  topK?: number;
  diversityLambda?: number;
  exactPhraseBoost?: number;
  sectionTitleBoost?: number;
  keywordOverlapBoost?: number;
  pageProximityPenalty?: number;
}

export interface AdjacentChunkRecommendation {
  document_id: string;
  chunk_id: string;
  ordinal: number;
  page_start: number;
  page_end: number;
  beforeOrdinal: number | null;
  afterOrdinal: number | null;
  reason: "edge_hit" | "strong_isolated_hit" | "near_duplicate_context";
}

const tokenRe = /[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu;
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

interface ScoredHit {
  hit: FusedHit;
  relevance: number;
  tokens: Set<string>;
  originalIndex: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return [...normalizeText(text).matchAll(tokenRe)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.min(left.size, right.size);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function pageProximity(left: FusedHit, right: FusedHit): number {
  if (left.metadata.document_id !== right.metadata.document_id) return 0;
  const distance = Math.min(
    Math.abs(left.metadata.page_start - right.metadata.page_end),
    Math.abs(right.metadata.page_start - left.metadata.page_end),
  );
  return clamp01(1 - distance / 3);
}

function normalizeScores(values: number[]): number[] {
  const finite = values.map((value) => (Number.isFinite(value) ? value : 0));
  const max = Math.max(0, ...finite);
  if (max <= 0) return finite.map(() => 0);
  return finite.map((value) => clamp01(value / max));
}

function exactPhraseScore(query: string, text: string): number {
  const normalizedQuery = normalizeText(query).replace(/^["']|["']$/g, "");
  if (normalizedQuery.length < 4) return 0;
  return normalizeText(text).includes(normalizedQuery) ? 1 : 0;
}

function scoreHits(hits: FusedHit[], query: string, options: Required<RerankOptions>): ScoredHit[] {
  const queryTokens = tokenSet(query);
  const rrfScores = normalizeScores(hits.map((hit) => hit.rrf_score));
  const lexicalScores = normalizeScores(hits.map((hit) => hit.lexical_score ?? 0));
  const vectorScores = normalizeScores(hits.map((hit) => hit.vector_score ?? 0));

  return hits.map((hit, index) => {
    const hitTokens = tokenSet(`${hit.metadata.section_title ?? ""} ${hit.text}`);
    const keywordOverlap = overlapRatio(queryTokens, hitTokens);
    const phraseBoost = options.exactPhraseBoost * exactPhraseScore(query, hit.text);
    const sectionBoost = options.sectionTitleBoost * overlapRatio(queryTokens, tokenSet(hit.metadata.section_title ?? ""));
    const keywordBoost = options.keywordOverlapBoost * keywordOverlap;
    const sourceScore = rrfScores[index] * 0.6 + lexicalScores[index] * 0.2 + vectorScores[index] * 0.2;
    const relevance = sourceScore + phraseBoost + sectionBoost + keywordBoost;
    return { hit, relevance, tokens: hitTokens, originalIndex: index };
  });
}

function similarityToSelected(candidate: ScoredHit, selected: ScoredHit[], pagePenalty: number): number {
  let maxSimilarity = 0;
  for (const selectedHit of selected) {
    const tokenSimilarity = jaccard(candidate.tokens, selectedHit.tokens);
    const proximitySimilarity = pagePenalty * pageProximity(candidate.hit, selectedHit.hit);
    maxSimilarity = Math.max(maxSimilarity, tokenSimilarity + proximitySimilarity);
  }
  return clamp01(maxSimilarity);
}

function cloneHit(hit: FusedHit): FusedHit {
  return {
    ...hit,
    metadata: { ...hit.metadata },
  };
}

export function rerankAndDiversifyHits(
  hits: FusedHit[],
  query: string,
  options: RerankOptions = {},
): FusedHit[] {
  if (!hits.length) return [];
  const resolved: Required<RerankOptions> = {
    topK: Math.max(1, options.topK ?? hits.length),
    diversityLambda: clamp01(options.diversityLambda ?? 0.72),
    exactPhraseBoost: options.exactPhraseBoost ?? 0.18,
    sectionTitleBoost: options.sectionTitleBoost ?? 0.14,
    keywordOverlapBoost: options.keywordOverlapBoost ?? 0.2,
    pageProximityPenalty: options.pageProximityPenalty ?? 0.35,
  };

  const remaining = scoreHits(hits, query, resolved);
  const selected: ScoredHit[] = [];
  while (remaining.length && selected.length < resolved.topK) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const diversityPenalty = similarityToSelected(candidate, selected, resolved.pageProximityPenalty);
      const score = resolved.diversityLambda * candidate.relevance - (1 - resolved.diversityLambda) * diversityPenalty;
      if (
        score > bestScore ||
        (score === bestScore && candidate.originalIndex < remaining[bestIndex]!.originalIndex)
      ) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (next) selected.push(next);
  }

  return selected.map(({ hit }) => cloneHit(hit));
}

export function recommendAdjacentChunkExpansions(
  hits: FusedHit[],
  query: string,
  options: { maxRecommendations?: number; strongScoreRatio?: number } = {},
): AdjacentChunkRecommendation[] {
  const maxRecommendations = Math.max(0, options.maxRecommendations ?? 6);
  if (!maxRecommendations || !hits.length) return [];

  const queryTokens = tokenSet(query);
  const maxScore = Math.max(0, ...hits.map((hit) => hit.rrf_score));
  const strongThreshold = maxScore * clamp01(options.strongScoreRatio ?? 0.7);
  const byDocument = new Map<string, Set<number>>();
  for (const hit of hits) {
    const ordinals = byDocument.get(hit.metadata.document_id) ?? new Set<number>();
    ordinals.add(hit.metadata.ordinal);
    byDocument.set(hit.metadata.document_id, ordinals);
  }

  const recommendations: AdjacentChunkRecommendation[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const ordinals = byDocument.get(hit.metadata.document_id) ?? new Set<number>();
    const candidateBefore = hit.metadata.ordinal - 1;
    const candidateAfter = hit.metadata.ordinal + 1;
    const beforeOrdinal = candidateBefore >= 0 && !ordinals.has(candidateBefore) ? candidateBefore : null;
    const afterOrdinal = candidateAfter >= 0 && !ordinals.has(candidateAfter) ? candidateAfter : null;
    if (beforeOrdinal === null && afterOrdinal === null) continue;

    const textOverlap = overlapRatio(queryTokens, tokenSet(hit.text));
    const atPageEdge = hit.metadata.page_start !== hit.metadata.page_end;
    const strong = hit.rrf_score >= strongThreshold || textOverlap >= 0.5;
    if (!atPageEdge && !strong) continue;

    const key = `${hit.metadata.document_id}:${hit.metadata.ordinal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recommendations.push({
      document_id: hit.metadata.document_id,
      chunk_id: hit.chunk_id,
      ordinal: hit.metadata.ordinal,
      page_start: hit.metadata.page_start,
      page_end: hit.metadata.page_end,
      beforeOrdinal,
      afterOrdinal,
      reason: atPageEdge ? "edge_hit" : strong ? "strong_isolated_hit" : "near_duplicate_context",
    });
    if (recommendations.length >= maxRecommendations) break;
  }
  return recommendations;
}
