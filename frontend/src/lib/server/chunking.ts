import type { ChunkRecord, DocumentMapResponse, PageRecord } from "./types";

const pageSep = "\n\n";
const markdownHeading = /^#+\s+\S.*$/;
const allCapsHeading = /^[A-Z0-9][A-Z0-9 \-:,&/()']{1,79}$/;
const numberedHeading = /^\d+(?:\.\d+)*\s+[A-Z].*$/;
const sentenceSplit = /(?<=[.!?])\s+(?=[A-Z])/;

interface ChunkData {
  ordinal: number;
  text: string;
  page_start: number;
  page_end: number;
  char_start: number;
  char_end: number;
  section_title: string | null;
  overlap_prefix_len: number;
}

function concatPages(pages: PageRecord[]): [string, number[]] {
  const parts: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  pages.forEach((page, index) => {
    offsets.push(cursor);
    parts.push(page.text);
    cursor += page.text.length;
    if (index !== pages.length - 1) {
      parts.push(pageSep);
      cursor += pageSep.length;
    }
  });
  return [parts.join(""), offsets];
}

function isHeading(line: string, prev?: string, next?: string): boolean {
  const stripped = line.trim();
  if (!stripped) return false;
  if (markdownHeading.test(stripped)) return true;
  if (numberedHeading.test(stripped) && stripped.length <= 120) return true;
  if (
    stripped.length >= 2 &&
    stripped.length <= 80 &&
    allCapsHeading.test(stripped) &&
    /[A-Z]/.test(stripped) &&
    stripped.toUpperCase() === stripped
  ) {
    return true;
  }
  return (
    (!prev || prev.trim() === "") &&
    (!next || next.trim() === "") &&
    stripped.length < 90 &&
    /^[A-Z]/.test(stripped) &&
    !/[.!?,]$/.test(stripped)
  );
}

function detectSections(fullText: string): Array<[number, number, string | null]> {
  const lines = fullText.split("\n");
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  const headingIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (isHeading(line, lines[index - 1], lines[index + 1])) {
      headingIndexes.push(index);
    }
  });

  const sections: Array<[number, number, string | null]> = [];
  if (!headingIndexes.length || headingIndexes[0] !== 0) {
    sections.push([0, headingIndexes.length ? starts[headingIndexes[0]] : fullText.length, null]);
  }
  headingIndexes.forEach((lineIndex, index) => {
    const end =
      index + 1 < headingIndexes.length
        ? starts[headingIndexes[index + 1]]
        : fullText.length;
    sections.push([starts[lineIndex], end, lines[lineIndex].replace(/^#+/, "").trim()]);
  });
  return sections.filter(([start, end]) => end > start);
}

function splitParagraphs(text: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let cursor = 0;
  for (const raw of text.split(/(\n\s*\n)/)) {
    if (!raw) continue;
    if (raw.trim() === "") {
      cursor += raw.length;
      continue;
    }
    out.push([cursor, raw]);
    cursor += raw.length;
  }
  return out;
}

function splitSentences(text: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let cursor = 0;
  for (const part of text.split(sentenceSplit)) {
    if (!part) continue;
    const start = text.indexOf(part, cursor);
    const resolved = start < 0 ? cursor : start;
    out.push([resolved, part]);
    cursor = resolved + part.length;
  }
  return out;
}

function packUnits(units: Array<[number, string]>, targetChars: number): Array<[number, number]> {
  if (!units.length) return [];
  const spans: Array<[number, number]> = [];
  let bufStart = units[0][0];
  const first = units[0][1];
  let bufEnd = bufStart + first.length;
  for (const [start, text] of units.slice(1)) {
    const end = start + text.length;
    if (bufEnd - bufStart + (start - bufEnd) + text.length <= targetChars) {
      bufEnd = end;
    } else {
      spans.push([bufStart, bufEnd]);
      bufStart = start;
      bufEnd = end;
    }
  }
  spans.push([bufStart, bufEnd]);
  return spans;
}

function sectionSpans(text: string, targetChars: number): Array<[number, number]> {
  const units: Array<[number, string]> = [];
  for (const [offset, paragraph] of splitParagraphs(text)) {
    if (paragraph.length <= targetChars) {
      units.push([offset, paragraph]);
    } else {
      for (const [sentenceOffset, sentence] of splitSentences(paragraph)) {
        units.push([offset + sentenceOffset, sentence]);
      }
    }
  }
  return packUnits(units, targetChars);
}

function pagesForSpan(start: number, end: number, pageOffsets: number[]): [number, number] {
  let pageStart = 1;
  let pageEnd = 1;
  const probe = Math.max(end - 1, start);
  pageOffsets.forEach((offset, index) => {
    if (offset <= start) pageStart = index + 1;
    if (offset <= probe) pageEnd = index + 1;
  });
  return [pageStart, pageEnd];
}

function overlapPrefix(text: string, overlapChars: number): string {
  if (!text || overlapChars <= 0) return "";
  if (text.length <= overlapChars) return text;
  const tail = text.slice(-overlapChars);
  const match = sentenceSplit.exec(tail);
  return match ? tail.slice(match.index + match[0].length) : tail;
}

export function chunkPages(pages: PageRecord[]): ChunkData[] {
  const [fullText, pageOffsets] = concatPages(pages);
  if (!fullText.trim()) return [];
  const chunks: ChunkData[] = [];
  let ordinal = 0;
  for (const [sectionStart, sectionEnd, title] of detectSections(fullText)) {
    const sectionText = fullText.slice(sectionStart, sectionEnd);
    let prevCore = "";
    for (const [localStart, localEnd] of sectionSpans(sectionText, 1200)) {
      const charStart = sectionStart + localStart;
      const charEnd = sectionStart + localEnd;
      const core = fullText.slice(charStart, charEnd);
      const overlap = prevCore ? overlapPrefix(prevCore, 200) : "";
      const [pageStart, pageEnd] = pagesForSpan(charStart, charEnd, pageOffsets);
      chunks.push({
        ordinal,
        text: overlap + core,
        page_start: pageStart,
        page_end: pageEnd,
        char_start: charStart,
        char_end: charEnd,
        section_title: title,
        overlap_prefix_len: overlap.length,
      });
      ordinal += 1;
      prevCore = core;
    }
  }
  return chunks;
}

export function buildDocumentMap(chunks: ChunkData[]): DocumentMapResponse {
  const sections: DocumentMapResponse["sections"] = [];
  for (const chunk of chunks) {
    const last = sections.at(-1);
    if (last && last.title === chunk.section_title) {
      last.chunk_ordinal_end = chunk.ordinal;
      last.page_start = Math.min(last.page_start, chunk.page_start);
      last.page_end = Math.max(last.page_end, chunk.page_end);
      last.chunk_count += 1;
    } else {
      sections.push({
        title: chunk.section_title,
        chunk_ordinal_start: chunk.ordinal,
        chunk_ordinal_end: chunk.ordinal,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        chunk_count: 1,
      });
    }
  }
  return {
    sections,
    num_chunks: chunks.length,
    num_pages: Math.max(0, ...chunks.map((chunk) => chunk.page_end)),
  };
}

const sentenceSummarySplit = /(?<=[.!?])\s+(?=[A-Z0-9])/;
const wordRe = /[A-Za-z][A-Za-z0-9'\-]*/g;
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

export function summarizeChunk(text: string, maxChars = 200): string {
  const normalized = text.trim();
  if (!normalized) return "";
  let summary = "";
  for (const sentence of normalized.split(sentenceSummarySplit).slice(0, 2)) {
    const candidate = summary ? `${summary} ${sentence.trim()}` : sentence.trim();
    if (candidate.length > maxChars && summary) break;
    summary = candidate;
  }
  return (summary || normalized).slice(0, maxChars).trim();
}

export function extractKeywords(text: string, topK = 8): string[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(wordRe)) {
    const token = match[0].toLowerCase();
    if (token.length < 3 || stopwords.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topK)
    .map(([token]) => token);
}

export function toChunkRecords(documentId: string, chunks: ChunkData[]): ChunkRecord[] {
  return chunks.map((chunk) => {
    const core = chunk.text.slice(chunk.overlap_prefix_len);
    return {
      id: crypto.randomUUID(),
      document_id: documentId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      char_start: chunk.char_start,
      char_end: chunk.char_end,
      section_title: chunk.section_title,
      overlap_prefix_len: chunk.overlap_prefix_len,
      summary: summarizeChunk(core),
      keywords: extractKeywords(core),
      embedding: [],
    };
  });
}
