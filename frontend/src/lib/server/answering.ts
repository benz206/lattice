import { embedderName } from "./embedding";
import { settings } from "./settings";
import { searchChunks } from "./retrieval";
import type { FusedHit } from "./types";

const minTopScore = 0.005;
const maxContextChars = 6000;
const rrfTopScore = 1 / 61;
const insufficientMarker = "INSUFFICIENT_EVIDENCE";
const insufficientAnswer = "Insufficient evidence to answer.";
const citationRe = /\[\s*[\u200b-\u200f\u2060\ufeff]*E[\u200b-\u200f\u2060\ufeff]*(\d+)[\u200b-\u200f\u2060\ufeff]*\s*\]/g;

interface EvidencePassage {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  page_start: number;
  page_end: number;
  section_title: string | null;
  text: string;
  score: number;
}

function passageFromHit(hit: FusedHit): EvidencePassage {
  return {
    chunk_id: hit.chunk_id,
    document_id: hit.metadata.document_id,
    ordinal: hit.metadata.ordinal,
    page_start: hit.metadata.page_start,
    page_end: hit.metadata.page_end,
    section_title: hit.metadata.section_title,
    text: hit.text,
    score: hit.rrf_score,
  };
}

function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const space = cut.lastIndexOf(" ");
  return cut.slice(0, space > maxLen * 0.5 ? space : maxLen).trimEnd();
}

function capPassages(passages: EvidencePassage[]): EvidencePassage[] {
  const out: EvidencePassage[] = [];
  let used = 0;
  for (const passage of passages) {
    const remaining = maxContextChars - used;
    if (remaining <= 0) break;
    if (passage.text.length <= remaining) {
      out.push(passage);
      used += passage.text.length;
    } else {
      const text = truncateAtBoundary(passage.text, remaining);
      if (text) out.push({ ...passage, text });
      break;
    }
  }
  return out;
}

function normalizeCitationTokens(answer: string): string {
  return answer.replace(citationRe, (_match, index: string) => `[E${Number.parseInt(index, 10)}]`);
}

function parseCitations(answer: string, passages: EvidencePassage[]) {
  const seen = new Set<number>();
  const citations = [];
  for (const match of answer.matchAll(citationRe)) {
    const index = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(index) || seen.has(index) || index < 1 || index > passages.length) {
      continue;
    }
    seen.add(index);
    const passage = passages[index - 1];
    citations.push({
      chunk_id: passage.chunk_id,
      document_id: passage.document_id,
      ordinal: passage.ordinal,
      page_start: passage.page_start,
      page_end: passage.page_end,
      section_title: passage.section_title,
    });
  }
  return citations;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function estimateConfidence(passages: EvidencePassage[], citationCount: number): number {
  if (!passages.length) return 0;
  const maxScore = Math.max(...passages.map((passage) => passage.score));
  const retrievalStrength = clamp01(maxScore / rrfTopScore);
  const citationFactor = 0.35 + 0.65 * clamp01(citationCount / 2);
  const evidenceFactor = 0.75 + 0.25 * clamp01(passages.length / 3);
  return clamp01(retrievalStrength * citationFactor * evidenceFactor);
}

async function generateWithLlm(query: string, passages: EvidencePassage[]): Promise<string> {
  if (settings.llmOverride === "stub" || settings.llmBackend === "stub") {
    const first = passages[0];
    return first
      ? `Based on the evidence: ${first.text.slice(0, 120)}. [E1]`
      : insufficientMarker;
  }
  if (settings.llmBackend !== "openai_compat") {
    return passages[0]
      ? `The local Next.js runtime found relevant evidence but no OpenAI-compatible LLM is configured. ${passages[0].text.slice(0, 160)} [E1]`
      : insufficientMarker;
  }
  const evidence = passages
    .map((passage, index) => `[E${index + 1}] (chunk=${passage.chunk_id} doc=${passage.document_id} pages=${passage.page_start}-${passage.page_end})\n${passage.text}`)
    .join("\n\n");
  const response = await fetch(`${settings.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {}),
      ...(settings.llmHttpReferer ? { "HTTP-Referer": settings.llmHttpReferer } : {}),
      ...(settings.llmAppTitle ? { "X-Title": settings.llmAppTitle } : {}),
    },
    body: JSON.stringify({
      model: settings.llmModel,
      temperature: 0,
      max_tokens: 2048,
      messages: [
        {
          role: "system",
          content:
            "Answer only using the evidence. Cite support as [E#]. If evidence is insufficient, reply INSUFFICIENT_EVIDENCE.",
        },
        {
          role: "user",
          content: `QUESTION: ${query}\n\nEVIDENCE:\n${evidence}\n\nWrite a concise answer with citations.`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM request failed: ${response.status}`);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function answerQuery({
  query,
  topK = 8,
  documentId,
}: {
  query: string;
  topK?: number;
  documentId?: string | null;
}) {
  const hits = await searchChunks({
    query,
    mode: "hybrid",
    topK,
    documentId,
  });
  const passages = capPassages(hits.map(passageFromHit));
  const maxScore = Math.max(0, ...hits.map((hit) => hit.rrf_score));
  const retrievalMeta = {
    hit_count: hits.length,
    max_score: maxScore,
    alpha: 0.5,
    top_k: topK,
    model: settings.llmBackend === "openai_compat" ? settings.llmModel : embedderName(),
    scoring: {
      confidence: 0,
      answer_score: 0,
      citation_count: 0,
      rrf_top_score: rrfTopScore,
    },
  };

  const dualSignal = hits.some(
    (hit) =>
      hit.vector_score !== null &&
      hit.vector_score > 0 &&
      hit.lexical_score !== null &&
      hit.lexical_score > 0,
  );
  if (!passages.length || (maxScore < minTopScore && !dualSignal)) {
    return {
      query,
      answer: insufficientAnswer,
      citations: [],
      evidence: passages,
      insufficient: true,
      confidence: 0,
      answer_score: 0,
      retrieval_meta: retrievalMeta,
    };
  }

  const answer = normalizeCitationTokens(await generateWithLlm(query, passages));
  if (answer === insufficientMarker) {
    return {
      query,
      answer: insufficientAnswer,
      citations: [],
      evidence: passages,
      insufficient: true,
      confidence: 0,
      answer_score: 0,
      retrieval_meta: retrievalMeta,
    };
  }
  const citations = parseCitations(answer, passages);
  const confidence = estimateConfidence(passages, citations.length);
  const answerScore = clamp01(confidence * (0.55 + 0.45 * clamp01(citations.length / 2)));
  retrievalMeta.scoring = {
    confidence,
    answer_score: answerScore,
    citation_count: citations.length,
    rrf_top_score: rrfTopScore,
  };
  return {
    query,
    answer,
    citations,
    evidence: passages,
    insufficient: false,
    confidence,
    answer_score: answerScore,
    retrieval_meta: retrievalMeta,
  };
}
