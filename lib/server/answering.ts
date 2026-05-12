import { embedderName } from "./embedding";
import { settings } from "./settings";
import { searchChunksWithMeta } from "./retrieval";
import type { FusedHit } from "./types";
import { packEvidence, type EvidencePassage } from "./evidence-packing";

const minTopScore = 0.005;
const maxContextChars = 6000;
const rrfTopScore = 1 / 61;
const insufficientMarker = "INSUFFICIENT_EVIDENCE";
const insufficientAnswer = "Insufficient evidence to answer.";
const citationRe = /\[\s*[​-‏⁠﻿]*E[​-‏⁠﻿]*(\d+)[​-‏⁠﻿]*\s*\]/g;
// OpenAI file_search–style annotations, e.g. 【E2†L1-L3】 or 【E2†source】.
const openAiAnnotationRe = /【\s*E\s*(\d+)\s*(?:†[^】]*)?】/g;

const reflectionEnabled = process.env.LATTICE_REFLECTION !== "off";

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

function normalizeCitationTokens(answer: string): string {
  return answer
    .replace(openAiAnnotationRe, (_match, index: string) => `[E${Number.parseInt(index, 10)}]`)
    .replace(citationRe, (_match, index: string) => `[E${Number.parseInt(index, 10)}]`);
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

async function generateWithLlm(
  query: string,
  passages: EvidencePassage[],
  anchorText: string | null,
): Promise<string> {
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
  const anchors = anchorText ? `\n\n${anchorText}` : "";
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
            "Answer only using the evidence. Cite support as [E#] using ASCII square brackets only — do not use 【E#†...】 or any other annotation format. If evidence is insufficient, reply INSUFFICIENT_EVIDENCE.",
        },
        {
          role: "user",
          content: `QUESTION: ${query}\n\nEVIDENCE:\n${evidence}${anchors}\n\nWrite a concise answer with citations.`,
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

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by a space, keeping the delimiter with the preceding sentence
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if ((text[i] === "." || text[i] === "?" || text[i] === "!") && text[i + 1] === " ") {
      parts.push(text.slice(start, i + 1));
      start = i + 2;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.filter((s) => s.trim().length > 0);
}

function extractCitationIndices(sentence: string): number[] {
  const indices: number[] = [];
  for (const match of sentence.matchAll(citationRe)) {
    const idx = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(idx)) indices.push(idx);
  }
  return indices;
}

interface ReflectionResult {
  answer: string
  sentences_total: number
  sentences_dropped: number
  verifier_calls: number
  reflection_triggered_requery: boolean
}

async function runReflection(
  answer: string,
  passages: EvidencePassage[],
  confidence: number,
): Promise<ReflectionResult> {
  const isStub = settings.llmOverride === "stub" || settings.llmBackend === "stub";
  if (isStub || !reflectionEnabled) {
    return {
      answer,
      sentences_total: 0,
      sentences_dropped: 0,
      verifier_calls: 0,
      reflection_triggered_requery: false,
    };
  }

  const sentences = splitSentences(answer);
  const citedSentences = sentences
    .map((s, i) => ({ sentence: s, index: i, citations: extractCitationIndices(s) }))
    .filter((item) => item.citations.length > 0);

  if (citedSentences.length === 0) {
    return {
      answer,
      sentences_total: sentences.length,
      sentences_dropped: 0,
      verifier_calls: 0,
      reflection_triggered_requery: false,
    };
  }

  const claimLines = citedSentences.map((item, claimNum) => {
    const evidenceTexts = item.citations
      .filter((idx) => idx >= 1 && idx <= passages.length)
      .map((idx) => passages[idx - 1].text)
      .join(" ")
    return `Claim ${claimNum + 1}: "${item.sentence}" Evidence: ${evidenceTexts}`
  })

  const batchedPrompt = `For each numbered claim below, reply with only "Claim N: YES" or "Claim N: NO" — one per line — indicating whether the evidence supports the claim.\n\n${claimLines.join("\n\n")}`

  const verifierResponse = await generateWithLlm(batchedPrompt, [], null)

  // Parse YES/NO per claim; default to YES on parse failure
  const verdicts: boolean[] = citedSentences.map(() => true)
  const lineRe = /Claim\s+(\d+)\s*:\s*(YES|NO)/gi
  for (const match of verifierResponse.matchAll(lineRe)) {
    const claimNum = Number.parseInt(match[1] ?? "", 10)
    const verdict = (match[2] ?? "").toUpperCase() === "YES"
    if (claimNum >= 1 && claimNum <= verdicts.length) {
      verdicts[claimNum - 1] = verdict
    }
  }

  const droppedIndices = new Set<number>()
  citedSentences.forEach((item, i) => {
    if (!verdicts[i]) droppedIndices.add(item.index)
  })

  const survivingSentences = sentences.filter((_, i) => !droppedIndices.has(i))
  const cleanedAnswer = survivingSentences.join(" ")
  const sentencesDropped = droppedIndices.size

  const survivingCited = citedSentences.length - sentencesDropped
  const requerySurvivorRatio = citedSentences.length > 0 ? survivingCited / citedSentences.length : 1
  const reflection_triggered_requery = requerySurvivorRatio < 0.5 && confidence < 0.4

  return {
    answer: cleanedAnswer,
    sentences_total: sentences.length,
    sentences_dropped: sentencesDropped,
    verifier_calls: 1,
    reflection_triggered_requery,
  }
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
  const { hits, meta: searchMeta } = await searchChunksWithMeta({
    query,
    mode: "hybrid",
    topK,
    documentId,
  });
  const packedEvidence = packEvidence(hits.map(passageFromHit), query, maxContextChars);
  const passages = packedEvidence.passages;
  const maxScore = Math.max(0, ...hits.map((hit) => hit.rrf_score));
  const retrievalMeta = {
    hit_count: hits.length,
    chunk_count: searchMeta.chunk_count,
    raw_hit_count: hits.length,
    packed_passage_count: passages.length,
    context_chars: packedEvidence.contextChars,
    raw_context_chars: packedEvidence.rawContextChars,
    deduplicated_chars: packedEvidence.deduplicatedChars,
    max_context_chars: maxContextChars,
    evidence_packing: {
      strategy: "query_focused_sentence_windows_with_dedup",
      anchor_chars: packedEvidence.anchorText?.length ?? 0,
    },
    max_score: maxScore,
    alpha: 0.5,
    top_k: topK,
    mode: searchMeta.mode,
    model: settings.llmBackend === "openai_compat" ? settings.llmModel : embedderName(),
    timing_ms: searchMeta.timing_ms,
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
      raw_answer: insufficientAnswer,
      citations: [],
      evidence: passages,
      insufficient: true,
      confidence: 0,
      answer_score: 0,
      retrieval_meta: retrievalMeta,
      reflection: {
        enabled: false,
        sentences_total: 0,
        sentences_dropped: 0,
        verifier_calls: 0,
        reflection_triggered_requery: false,
      },
    };
  }

  const rawAnswer = normalizeCitationTokens(await generateWithLlm(query, passages, packedEvidence.anchorText));
  if (rawAnswer === insufficientMarker) {
    return {
      query,
      answer: insufficientAnswer,
      raw_answer: insufficientAnswer,
      citations: [],
      evidence: passages,
      insufficient: true,
      confidence: 0,
      answer_score: 0,
      retrieval_meta: retrievalMeta,
      reflection: {
        enabled: false,
        sentences_total: 0,
        sentences_dropped: 0,
        verifier_calls: 0,
        reflection_triggered_requery: false,
      },
    };
  }

  const citations = parseCitations(rawAnswer, passages);
  const confidence = estimateConfidence(passages, citations.length);
  const answerScore = clamp01(confidence * (0.55 + 0.45 * clamp01(citations.length / 2)));
  retrievalMeta.scoring = {
    confidence,
    answer_score: answerScore,
    citation_count: citations.length,
    rrf_top_score: rrfTopScore,
  };

  const isStub = settings.llmOverride === "stub" || settings.llmBackend === "stub";
  const reflectionActive = reflectionEnabled && !isStub;
  let finalAnswer = rawAnswer;
  let reflectionMeta = {
    enabled: reflectionActive,
    sentences_total: 0,
    sentences_dropped: 0,
    verifier_calls: 0,
    reflection_triggered_requery: false,
  };

  if (reflectionActive) {
    const result = await runReflection(rawAnswer, passages, confidence);
    finalAnswer = result.answer;
    reflectionMeta = {
      enabled: true,
      sentences_total: result.sentences_total,
      sentences_dropped: result.sentences_dropped,
      verifier_calls: result.verifier_calls,
      reflection_triggered_requery: result.reflection_triggered_requery,
    };
  }

  return {
    query,
    answer: finalAnswer,
    raw_answer: rawAnswer,
    citations,
    evidence: passages,
    insufficient: false,
    confidence,
    answer_score: answerScore,
    retrieval_meta: retrievalMeta,
    reflection: reflectionMeta,
  };
}
