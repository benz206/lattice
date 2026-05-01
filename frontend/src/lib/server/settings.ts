import path from "node:path";

function repoRoot(): string {
  return path.basename(process.cwd()) === "frontend"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}

function resolveRepoPath(value: string): string {
  if (path.isAbsolute(value)) return value;
  return path.resolve(repoRoot(), value);
}

export const settings = {
  repoRoot: repoRoot(),
  dataDir: resolveRepoPath(process.env.DATA_DIR ?? "./data"),
  uploadDir: resolveRepoPath(process.env.UPLOAD_DIR ?? "./data/uploads"),
  maxUploadMb: Number.parseInt(process.env.MAX_UPLOAD_MB ?? "200", 10),
  embedder: (process.env.LATTICE_EMBEDDER ?? "hash").trim().toLowerCase(),
  embeddingModel: process.env.EMBEDDING_MODEL ?? "hash-local",
  embeddingBaseUrl:
    process.env.LATTICE_EMBEDDING_BASE_URL ?? "https://openrouter.ai/api/v1",
  embeddingApiKey:
    process.env.LATTICE_EMBEDDING_API_KEY ?? process.env.LATTICE_LLM_API_KEY ?? "",
  embedBatchSize: Math.max(
    1,
    Number.parseInt(process.env.LATTICE_EMBED_BATCH_SIZE ?? "16", 10),
  ),
  llmOverride: (process.env.LATTICE_LLM ?? "").trim().toLowerCase(),
  llmBackend: (process.env.LLM_BACKEND ?? "openai_compat").trim().toLowerCase(),
  llmModel: process.env.LLM_MODEL ?? "qwen2.5:1.5b-instruct",
  llmBaseUrl: process.env.LATTICE_LLM_BASE_URL ?? "http://localhost:11434/v1",
  llmApiKey: process.env.LATTICE_LLM_API_KEY ?? "",
  llmHttpReferer: process.env.LATTICE_LLM_HTTP_REFERER ?? "",
  llmAppTitle: process.env.LATTICE_LLM_APP_TITLE ?? "Lattice",
};
