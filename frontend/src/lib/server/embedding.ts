import { createHash } from "node:crypto";
import { settings } from "./settings";

const dim = 256;
const tokenRe = /\W+/;

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function hashVector(text: string): number[] {
  const vector = Array.from({ length: dim }, () => 0);
  for (const token of text.toLowerCase().split(tokenRe)) {
    if (!token) continue;
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) & (dim - 1);
    vector[index] += 1;
  }
  return normalize(vector);
}

async function remoteEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${settings.embeddingBaseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.embeddingApiKey
        ? { Authorization: `Bearer ${settings.embeddingApiKey}` }
        : {}),
      ...(settings.llmHttpReferer ? { "HTTP-Referer": settings.llmHttpReferer } : {}),
      ...(settings.llmAppTitle ? { "X-Title": settings.llmAppTitle } : {}),
    },
    body: JSON.stringify({ model: settings.embeddingModel, input: texts }),
  });
  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const rows = body.data?.map((row) => row.embedding ?? []) ?? [];
  if (rows.length !== texts.length) {
    throw new Error("Embedding response row count did not match input count.");
  }
  return rows.map(normalize);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (settings.embedder === "openai_compat" || settings.embedder === "openrouter") {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += settings.embedBatchSize) {
      out.push(...(await remoteEmbeddings(texts.slice(i, i + settings.embedBatchSize))));
    }
    return out;
  }
  return texts.map(hashVector);
}

export function embedderName(): string {
  if (settings.embedder === "openai_compat" || settings.embedder === "openrouter") {
    return settings.embeddingModel;
  }
  return "hash-local-embedder";
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}
