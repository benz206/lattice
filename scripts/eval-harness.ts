#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import { searchChunksWithMeta } from "../lib/server/retrieval";
import { answerQuery } from "../lib/server/answering";
import { readChunks, withStore } from "../lib/server/store";
import { settings } from "../lib/server/settings";
import type { ChunkRecord, SearchMode } from "../lib/server/types";

interface Options {
  documentId: string;
  numQuestions: number;
  topK: number;
  modes: SearchMode[];
  output: string | null;
  skipAnswer: boolean;
  seed: number | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    documentId: "",
    numQuestions: 20,
    topK: 5,
    modes: ["hybrid"],
    output: null,
    skipAnswer: false,
    seed: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--document-id" && next) {
      opts.documentId = next;
      i++;
    } else if (arg === "--num-questions" && next) {
      opts.numQuestions = Math.max(1, Number.parseInt(next, 10) || opts.numQuestions);
      i++;
    } else if (arg === "--top-k" && next) {
      opts.topK = Math.max(1, Number.parseInt(next, 10) || opts.topK);
      i++;
    } else if (arg === "--modes" && next) {
      const parsed = next.split(",").map((m) => m.trim()) as SearchMode[];
      const valid = parsed.filter((m) => m === "hybrid" || m === "vector" || m === "lexical");
      if (valid.length) opts.modes = valid;
      i++;
    } else if (arg === "--output" && next) {
      opts.output = next;
      i++;
    } else if (arg === "--skip-answer") {
      opts.skipAnswer = true;
    } else if (arg === "--seed" && next) {
      const n = Number.parseInt(next, 10);
      if (Number.isFinite(n)) opts.seed = n;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`Usage: bun scripts/eval-harness.ts --document-id <id> [options]

Options:
  --document-id <id>           Required. Document to evaluate.
  --num-questions <n>          Number of synthetic Q&A pairs to generate. Default: 20.
  --top-k <k>                  Retrieval top-k. Default: 5.
  --modes <m1,m2,...>          Comma-separated modes: hybrid,vector,lexical. Default: hybrid.
  --output <file.json>         Write full per-question results to JSON file.
  --skip-answer                Only run retrieval; skip answer faithfulness phase.
  --seed <n>                   Deterministic chunk sampling seed.
  -h, --help                   Show this help.
`);
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function sampleChunks(chunks: ChunkRecord[], n: number, seed: number | null): ChunkRecord[] {
  const pool = [...chunks];
  const rand = seed !== null ? seededRandom(seed) : Math.random.bind(Math);
  const result: ChunkRecord[] = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    result.push(pool[i]!);
  }
  return result;
}

function pLimit(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        running++;
        fn().then(resolve, reject).finally(() => {
          running--;
          if (queue.length) queue.shift()!();
        });
      };
      if (running < concurrency) run();
      else queue.push(run);
    });
  };
}

async function callLlmRaw(prompt: string): Promise<string> {
  if (settings.llmOverride === "stub" || settings.llmBackend === "stub") {
    return "__STUB__";
  }
  if (settings.llmBackend !== "openai_compat") {
    throw new Error(`Unsupported llmBackend for eval: ${settings.llmBackend}. Set LLM_BACKEND=openai_compat.`);
  }
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
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`LLM request failed: ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

interface QAPair {
  chunk_id: string;
  question: string;
  gold_answer: string;
}

async function generateQAPair(chunk: ChunkRecord, limit: ReturnType<typeof pLimit>): Promise<QAPair | null> {
  const prompt = `Given the passage below, write ONE specific question that can be answered using ONLY this passage. The question should be answerable in one sentence and should not be answerable from general world knowledge.

Output strictly in this format (no extra prose):
QUESTION: <the question>
ANSWER: <a one-sentence answer derived from the passage>

Passage: ${chunk.text}`;

  try {
    const raw = await limit(() => callLlmRaw(prompt));
    if (raw === "__STUB__") {
      return {
        chunk_id: chunk.id,
        question: `What does chunk ${chunk.ordinal} describe?`,
        gold_answer: chunk.text.slice(0, 80),
      };
    }
    const qMatch = raw.match(/^QUESTION:\s*(.+)$/m);
    const aMatch = raw.match(/^ANSWER:\s*(.+)$/m);
    if (!qMatch?.[1] || !aMatch?.[1]) return null;
    return { chunk_id: chunk.id, question: qMatch[1].trim(), gold_answer: aMatch[1].trim() };
  } catch {
    return null;
  }
}

interface RetrievalMetrics {
  recall: number;
  mrr: number;
  latencies: number[];
}

interface PerQuestionRetrieval {
  question: string;
  chunk_id: string;
  hit: boolean;
  rank: number | null;
  latency_ms: number;
}

async function runRetrieval(
  pairs: QAPair[],
  mode: SearchMode,
  topK: number,
  documentId: string,
): Promise<{ metrics: RetrievalMetrics; perQuestion: PerQuestionRetrieval[] }> {
  const perQuestion: PerQuestionRetrieval[] = [];
  let recallSum = 0;
  let mrrSum = 0;
  const latencies: number[] = [];

  for (const pair of pairs) {
    let result: Awaited<ReturnType<typeof searchChunksWithMeta>>;
    try {
      result = await searchChunksWithMeta({ query: pair.question, mode, topK, documentId });
    } catch {
      perQuestion.push({ question: pair.question, chunk_id: pair.chunk_id, hit: false, rank: null, latency_ms: 0 });
      continue;
    }
    const { hits, meta } = result;
    const latency = meta.timing_ms.search_total ?? 0;
    latencies.push(latency);

    const rank = hits.findIndex((h) => h.chunk_id === pair.chunk_id);
    const hit = rank !== -1;
    recallSum += hit ? 1 : 0;
    mrrSum += hit ? 1 / (rank + 1) : 0;
    perQuestion.push({ question: pair.question, chunk_id: pair.chunk_id, hit, rank: hit ? rank + 1 : null, latency_ms: latency });
  }

  const n = pairs.length || 1;
  return {
    metrics: { recall: recallSum / n, mrr: mrrSum / n, latencies },
    perQuestion,
  };
}

interface FaithfulnessResult {
  faithful: boolean | null;
  insufficient: boolean;
  requery: boolean;
  answer: string;
}

async function runAnswer(
  pair: QAPair,
  topK: number,
  documentId: string,
  limit: ReturnType<typeof pLimit>,
): Promise<FaithfulnessResult> {
  let answerResult: Awaited<ReturnType<typeof answerQuery>>;
  try {
    answerResult = await answerQuery({ query: pair.question, topK, documentId });
  } catch {
    return { faithful: null, insufficient: false, requery: false, answer: "" };
  }

  const requery = answerResult.reflection?.reflection_triggered_requery ?? false;

  if (answerResult.insufficient) {
    return { faithful: null, insufficient: true, requery, answer: answerResult.answer };
  }

  const faithPrompt = `Does the following answer correctly answer the question given the gold answer? Reply only YES or NO.

Question: ${pair.question}
Gold answer: ${pair.gold_answer}
Answer to evaluate: ${answerResult.answer}`;

  try {
    const raw = await limit(() => callLlmRaw(faithPrompt));
    if (raw === "__STUB__") return { faithful: true, insufficient: false, requery, answer: answerResult.answer };
    const verdict = raw.trim().toUpperCase().startsWith("YES");
    return { faithful: verdict, insufficient: false, requery, answer: answerResult.answer };
  } catch {
    return { faithful: null, insufficient: false, requery, answer: answerResult.answer };
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
}

function pad(s: string, n: number): string {
  return s.padStart(n);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.documentId) {
    console.error("Error: --document-id is required.");
    printHelp();
    process.exit(1);
  }

  const isStub = settings.llmOverride === "stub" || settings.llmBackend === "stub";
  if (isStub) {
    console.log("LATTICE_LLM=stub detected. Synthetic Q&A will use deterministic stub output.");
    console.log("For real eval metrics, configure a real LLM endpoint (LATTICE_LLM_BASE_URL, LLM_MODEL, LATTICE_LLM_API_KEY).");
    console.log("Continuing with stub output...");
    console.log("");
  }

  const allChunks = await readChunks(opts.documentId);
  const chunks = allChunks.filter((c) => c.document_id === opts.documentId);

  if (!chunks.length) {
    console.log(`No chunks found for document ${opts.documentId}. Ingest the document before running eval.`);
    process.exit(1);
  }

  const readyIds = await withStore(async (store) =>
    new Set(store.listDocuments().filter((d) => d.status === "ready").map((d) => d.id)),
  );
  if (!readyIds.has(opts.documentId)) {
    console.log(`Document ${opts.documentId} is not in ready state. Ensure ingestion is complete.`);
    process.exit(1);
  }

  const sampled = sampleChunks(chunks, opts.numQuestions, opts.seed);
  console.log(`Lattice Eval — document ${opts.documentId}`);
  console.log(`Generating ${sampled.length} Q&A pairs from ${chunks.length} chunks...`);

  const limit = pLimit(4);
  const pairResults = await Promise.all(sampled.map((chunk) => generateQAPair(chunk, limit)));
  const pairs = pairResults.filter((p): p is QAPair => p !== null);
  const skipped = sampled.length - pairs.length;

  console.log(`Generated ${pairs.length} questions (${skipped} skipped)`);
  console.log("");

  const retrievalReport: Record<string, { metrics: RetrievalMetrics; perQuestion: PerQuestionRetrieval[] }> = {};
  for (const mode of opts.modes) {
    retrievalReport[mode] = await runRetrieval(pairs, mode, opts.topK, opts.documentId);
  }

  console.log(`Retrieval (top-${opts.topK})`);
  for (const mode of opts.modes) {
    const { metrics } = retrievalReport[mode]!;
    const sorted = [...metrics.latencies].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    console.log(
      `  ${pad(mode + ":", 9)} recall@k = ${metrics.recall.toFixed(2)}   mrr = ${metrics.mrr.toFixed(2)}   p50 = ${pad(p50.toFixed(0), 3)}ms   p95 = ${pad(p95.toFixed(0), 3)}ms`,
    );
  }

  const answerReport: Array<{ question: string; chunk_id: string; gold_answer: string } & FaithfulnessResult> = [];
  let faithfulnessRate: number | null = null;
  let insufficientCount = 0;
  let requeryCount = 0;

  if (!opts.skipAnswer && pairs.length > 0) {
    console.log("");
    console.log("Running answer faithfulness (hybrid)...");
    const answerLimit = pLimit(2);
    const answerResults = await Promise.all(
      pairs.map((pair) =>
        answerLimit(() => runAnswer(pair, opts.topK, opts.documentId, limit)),
      ),
    );
    for (let i = 0; i < pairs.length; i++) {
      const r = answerResults[i]!;
      answerReport.push({ ...pairs[i]!, ...r });
      if (r.insufficient) insufficientCount++;
      if (r.requery) requeryCount++;
    }
    const judged = answerResults.filter((r) => r.faithful !== null);
    faithfulnessRate = judged.length ? judged.filter((r) => r.faithful).length / judged.length : null;

    console.log("");
    console.log("Answering (hybrid)");
    console.log(`  faithfulness  = ${faithfulnessRate !== null ? faithfulnessRate.toFixed(2) : "n/a"}`);
    console.log(`  insufficient  = ${insufficientCount}/${pairs.length}`);
    console.log(`  requery flags = ${requeryCount}/${pairs.length}`);
  }

  if (opts.output) {
    const report = {
      document_id: opts.documentId,
      generated: pairs.length,
      skipped,
      top_k: opts.topK,
      retrieval: Object.fromEntries(
        opts.modes.map((mode) => {
          const { metrics, perQuestion } = retrievalReport[mode]!;
          return [mode, { recall_at_k: metrics.recall, mrr: metrics.mrr, per_question: perQuestion }];
        }),
      ),
      ...(opts.skipAnswer
        ? {}
        : {
            answering: {
              faithfulness_rate: faithfulnessRate,
              insufficient_count: insufficientCount,
              requery_count: requeryCount,
              per_question: answerReport,
            },
          }),
    };
    await writeFile(opts.output, JSON.stringify(report, null, 2));
    console.log(`\nWrote report to ${opts.output}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
