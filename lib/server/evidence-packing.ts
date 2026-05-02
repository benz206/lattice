export interface EvidencePassage {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  page_start: number;
  page_end: number;
  section_title: string | null;
  text: string;
  score: number;
}

export interface PackedEvidence {
  passages: EvidencePassage[];
  rawContextChars: number;
  contextChars: number;
  deduplicatedChars: number;
  anchorText: string | null;
}

const defaultMaxContextChars = 6000;
const maxSnippetsPerPassage = 3;
const targetPassageChars = 950;
const minPassageChars = 220;
const tokenRe = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
const sentenceRe = /[^.!?\n]+(?:[.!?]+|$)|[^\n]+/g;
const stopwords = new Set([
  "the", "and", "for", "that", "with", "this", "are", "was", "but", "not",
  "you", "your", "all", "any", "can", "had", "has", "have", "from", "they",
  "their", "them", "there", "these", "those", "then", "than", "which", "who",
  "what", "when", "where", "why", "how", "will", "would", "could", "should",
  "may", "might", "must", "been", "being", "were", "into", "onto", "out",
  "off", "over", "under", "again", "further", "about", "above", "below",
  "because", "before", "after", "between", "during", "through", "while",
  "same", "some", "such", "each", "every", "few", "more", "most", "other",
  "own", "only", "very", "also", "just", "thus", "upon", "does", "did",
  "a", "an", "as", "at", "be", "by", "if", "in", "is", "it", "of", "on",
  "or", "to", "we", "i",
]);

function tokenize(text: string): string[] {
  return [...text.toLowerCase().matchAll(tokenRe)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  const sentences = [...text.matchAll(sentenceRe)]
    .map((match) => match[0].replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return sentences.length ? sentences : [text.replace(/\s+/g, " ").trim()].filter(Boolean);
}

function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (boundary > maxLen * 0.45) return cut.slice(0, boundary + 1).trimEnd();
  const space = cut.lastIndexOf(" ");
  return cut.slice(0, space > maxLen * 0.5 ? space : maxLen).trimEnd();
}

function sentenceScore(sentence: string, queryTerms: Set<string>, phrase: string): number {
  const normalized = normalizeText(sentence);
  let score = phrase && normalized.includes(phrase) ? 4 : 0;
  const seen = new Set<string>();
  for (const token of tokenize(sentence)) {
    if (queryTerms.has(token) && !seen.has(token)) {
      score += token.length >= 6 ? 1.4 : 1;
      seen.add(token);
    }
  }
  return score;
}

function overlapsExisting(normalized: string, seen: Set<string>): boolean {
  if (!normalized) return true;
  if (seen.has(normalized)) return true;
  for (const existing of seen) {
    if (normalized.length >= 80 && existing.includes(normalized)) return true;
    if (existing.length >= 80 && normalized.includes(existing)) return true;
  }
  return false;
}

function markSeen(text: string, seen: Set<string>): void {
  for (const sentence of splitSentences(text)) {
    const normalized = normalizeText(sentence);
    if (normalized.length >= 24) seen.add(normalized);
  }
}

function queryFocusedSnippet(
  text: string,
  queryTerms: Set<string>,
  queryPhrase: string,
  seen: Set<string>,
): string {
  const sentences = splitSentences(text);
  const ranked = sentences
    .map((sentence, index) => ({
      index,
      score: sentenceScore(sentence, queryTerms, queryPhrase),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Set<number>();
  const candidateIndexes = ranked.some((item) => item.score > 0)
    ? ranked.filter((item) => item.score > 0).slice(0, maxSnippetsPerPassage)
    : ranked.slice(0, 1);

  for (const candidate of candidateIndexes) {
    selected.add(candidate.index);
    if (candidate.index > 0) selected.add(candidate.index - 1);
    if (candidate.index < sentences.length - 1) selected.add(candidate.index + 1);
  }

  const snippets: string[] = [];
  for (const index of [...selected].sort((a, b) => a - b)) {
    const sentence = sentences[index];
    if (!sentence) continue;
    const normalized = normalizeText(sentence);
    if (normalized.length >= 24 && overlapsExisting(normalized, seen)) continue;
    snippets.push(sentence);
    if (snippets.join(" ").length >= targetPassageChars) break;
  }

  if (!snippets.length) {
    for (const sentence of sentences) {
      const normalized = normalizeText(sentence);
      if (normalized.length < 24 || !overlapsExisting(normalized, seen)) {
        snippets.push(sentence);
      }
      if (snippets.join(" ").length >= minPassageChars) break;
    }
  }

  let snippet = snippets.join(" ");
  if (snippet.length < minPassageChars && !snippets.length && !seen.size) {
    snippet = truncateAtBoundary(text.replace(/\s+/g, " ").trim(), targetPassageChars);
  }

  return truncateAtBoundary(snippet, targetPassageChars);
}

function buildAnchor(passages: EvidencePassage[], maxLen: number): string | null {
  if (passages.length < 2 || maxLen < 180) return null;
  const parts = passages.slice(0, Math.min(4, passages.length)).map((passage, index) => {
    const firstSentence = splitSentences(passage.text)[0] ?? passage.text;
    return `[E${index + 1}] ${truncateAtBoundary(firstSentence, 150)}`;
  });
  const anchor = `Evidence anchors: ${parts.join(" | ")}`;
  return truncateAtBoundary(anchor, maxLen);
}

export function packEvidence(
  passages: EvidencePassage[],
  query: string,
  maxContextChars = defaultMaxContextChars,
): PackedEvidence {
  const rawContextChars = passages.reduce((sum, passage) => sum + passage.text.length, 0);
  const queryTerms = new Set(tokenize(query));
  const queryPhrase = normalizeText(query);
  const seen = new Set<string>();
  const packed: EvidencePassage[] = [];
  let used = 0;

  for (const passage of passages) {
    const remaining = maxContextChars - used;
    if (remaining <= 0) break;

    let text = queryFocusedSnippet(passage.text, queryTerms, queryPhrase, seen);
    if (!text) continue;
    if (text.length > remaining) text = truncateAtBoundary(text, remaining);
    if (!text) break;

    packed.push({ ...passage, text });
    used += text.length;
    markSeen(text, seen);
  }

  const anchorBudget = Math.min(650, Math.max(0, maxContextChars - used));
  const anchorText = buildAnchor(packed, anchorBudget);
  return {
    passages: packed,
    rawContextChars,
    contextChars: used + (anchorText?.length ?? 0),
    deduplicatedChars: Math.max(0, rawContextChars - used),
    anchorText,
  };
}
