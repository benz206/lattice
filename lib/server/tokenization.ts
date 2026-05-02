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

export const lexicalTokenizerVersion = "retrieval-tokenizer-v1";

export function tokenizeForLexicalSearch(text: string): string[] {
  return [...text.toLowerCase().matchAll(tokenRe)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2 && !stopwords.has(token));
}
