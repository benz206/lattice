export type QueryVariantKind =
  | "normalized"
  | "lexical"
  | "phrase"
  | "acronym"
  | "symbol"
  | "pseudo_hyde";

export interface QueryVariant {
  query: string;
  kind: QueryVariantKind;
  weight: number;
}

export interface QueryExpansionOptions {
  maxVariants?: number;
  includeQuotedPhrase?: boolean;
  pseudoHydeText?: string | null;
  maxPseudoHydeChars?: number;
}

export interface ExpandedQuery {
  original: string;
  normalized: string;
  variants: QueryVariant[];
  searchQueries: string[];
}

const tokenRe = /[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu;
const whitespaceRe = /\s+/g;
const questionPrefixes = [
  "what is",
  "what are",
  "where is",
  "where are",
  "when is",
  "when are",
  "who is",
  "who are",
  "why is",
  "why are",
  "how does",
  "how do",
  "how is",
  "how are",
  "tell me about",
  "show me",
  "find",
];

const symbolExpansions: Array<[RegExp, string]> = [
  [/&/g, " and "],
  [/@/g, " at "],
  [/%/g, " percent "],
  [/\+/g, " plus "],
  [/#/g, " number "],
  [/\$/g, " dollar "],
  [/=/g, " equals "],
];

function dedupeVariants(variants: QueryVariant[], maxVariants: number): QueryVariant[] {
  const seen = new Set<string>();
  const out: QueryVariant[] = [];
  for (const variant of variants) {
    const query = normalizeQuery(variant.query);
    if (!query || seen.has(query)) continue;
    seen.add(query);
    out.push({ ...variant, query });
    if (out.length >= maxVariants) break;
  }
  return out;
}

function tokensOf(text: string): string[] {
  return [...text.matchAll(tokenRe)].map((match) => match[0].toLowerCase());
}

function stripQuestionPrefix(query: string): string {
  for (const prefix of questionPrefixes) {
    if (query.startsWith(`${prefix} `)) return query.slice(prefix.length).trim();
  }
  return query;
}

function lexicalVariants(normalized: string): string[] {
  const variants = new Set<string>();
  const tokens = tokensOf(normalized);
  for (const token of tokens) {
    if (token.includes("-")) variants.add(normalized.replaceAll(token, token.replaceAll("-", " ")));
    if (token.includes("_")) variants.add(normalized.replaceAll(token, token.replaceAll("_", " ")));
    if (token.endsWith("ies") && token.length > 4) variants.add(normalized.replaceAll(token, `${token.slice(0, -3)}y`));
    if (token.endsWith("s") && token.length > 3) variants.add(normalized.replaceAll(token, token.slice(0, -1)));
    if (!token.endsWith("s") && token.length > 3) variants.add(normalized.replaceAll(token, `${token}s`));
  }
  const hyphenJoined = normalized.replace(/\b([\p{L}\p{N}]+)\s+([\p{L}\p{N}]+)\b/gu, "$1-$2");
  if (hyphenJoined !== normalized) variants.add(hyphenJoined);
  return [...variants];
}

function symbolVariants(query: string): string[] {
  const variants = new Set<string>();
  let expanded = query;
  for (const [pattern, replacement] of symbolExpansions) {
    expanded = expanded.replace(pattern, replacement);
  }
  expanded = normalizeQuery(expanded);
  if (expanded && expanded !== normalizeQuery(query)) variants.add(expanded);

  const slashSpaced = normalizeQuery(query.replace(/[\\/]/g, " "));
  if (slashSpaced && slashSpaced !== normalizeQuery(query)) variants.add(slashSpaced);

  const compact = normalizeQuery(query.replace(/[^\p{L}\p{N}\s]/gu, ""));
  if (compact && compact !== normalizeQuery(query)) variants.add(compact);
  return [...variants];
}

function acronymVariant(normalized: string): string | null {
  const tokens = tokensOf(normalized).filter((token) => token.length > 2);
  if (tokens.length < 2 || tokens.length > 8) return null;
  const acronym = tokens.map((token) => token[0]).join("");
  return acronym.length >= 2 ? acronym : null;
}

function truncateAtWord(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return cut.slice(0, lastSpace > maxChars * 0.5 ? lastSpace : maxChars).trim();
}

export function normalizeQuery(query: string): string {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[?!.:,;]+$/g, "")
    .replace(whitespaceRe, " ")
    .trim();
}

export function expandQuery(query: string, options: QueryExpansionOptions = {}): ExpandedQuery {
  const maxVariants = Math.max(1, options.maxVariants ?? 12);
  const includeQuotedPhrase = options.includeQuotedPhrase ?? true;
  const maxPseudoHydeChars = Math.max(80, options.maxPseudoHydeChars ?? 800);
  const normalized = normalizeQuery(query);
  const variants: QueryVariant[] = [];

  if (normalized) {
    variants.push({ query: normalized, kind: "normalized", weight: 1 });

    const stripped = stripQuestionPrefix(normalized);
    if (stripped !== normalized) variants.push({ query: stripped, kind: "phrase", weight: 0.9 });

    if (includeQuotedPhrase && tokensOf(normalized).length > 1) {
      variants.push({ query: `"${normalized}"`, kind: "phrase", weight: 0.85 });
    }

    for (const lexical of lexicalVariants(normalized)) {
      variants.push({ query: lexical, kind: "lexical", weight: 0.7 });
    }

    for (const symbol of symbolVariants(query)) {
      variants.push({ query: symbol, kind: "symbol", weight: 0.7 });
    }

    const acronym = acronymVariant(normalized);
    if (acronym) variants.push({ query: `${normalized} ${acronym}`, kind: "acronym", weight: 0.65 });
  }

  const pseudoHyde = normalizeQuery(options.pseudoHydeText ?? "");
  if (pseudoHyde) {
    variants.push({
      query: truncateAtWord(pseudoHyde, maxPseudoHydeChars),
      kind: "pseudo_hyde",
      weight: 0.55,
    });
  }

  const deduped = dedupeVariants(variants, maxVariants);
  return {
    original: query,
    normalized,
    variants: deduped,
    searchQueries: deduped.map((variant) => variant.query),
  };
}
