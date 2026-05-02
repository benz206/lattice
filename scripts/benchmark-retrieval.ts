#!/usr/bin/env bun

import { searchChunksWithMeta } from "../lib/server/retrieval";
import { readChunks, withStore } from "../lib/server/store";
import type { ChunkRecord, SearchMode } from "../lib/server/types";

interface Options {
  queries: string[];
  mode: SearchMode;
  topK: number;
  documentId: string | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    queries: [],
    mode: "hybrid",
    topK: 8,
    documentId: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--query" || arg === "-q") && next) {
      opts.queries.push(next);
      i += 1;
    } else if (arg === "--mode" && next) {
      if (next === "hybrid" || next === "vector" || next === "lexical") {
        opts.mode = next;
      } else {
        throw new Error(`Unsupported mode: ${next}`);
      }
      i += 1;
    } else if ((arg === "--top-k" || arg === "-k") && next) {
      opts.topK = Math.max(1, Number.parseInt(next, 10) || opts.topK);
      i += 1;
    } else if (arg === "--document-id" && next) {
      opts.documentId = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg) {
      opts.queries.push(arg);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`Usage: bun scripts/benchmark-retrieval.ts [options] [query...]

Options:
  -q, --query <text>       Query to run. May be repeated.
  --mode <mode>            hybrid, vector, or lexical. Default: hybrid.
  -k, --top-k <number>     Hits to return. Default: 8.
  --document-id <id>       Restrict benchmark to one document.
  -h, --help               Show this help.
`);
}

function compact(text: string, max = 96): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}...`;
}

function defaultQueries(chunks: ChunkRecord[]): string[] {
  const candidates = chunks
    .flatMap((chunk) => [
      chunk.section_title ?? "",
      chunk.summary ?? "",
      chunk.keywords.slice(0, 5).join(" "),
      chunk.text,
    ])
    .map((text) => compact(text, 80))
    .filter((text) => text.length >= 8);

  return [...new Set(candidates)].slice(0, 5);
}

async function readyDocumentIds(): Promise<Set<string>> {
  return withStore(async (store) =>
    new Set(
      store
        .listDocuments()
        .filter((document) => document.status === "ready")
        .map((document) => document.id),
    ),
  );
}

function formatMs(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "-";
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const chunks = await readChunks(opts.documentId ?? undefined);
  const readyIds = await readyDocumentIds();
  const readyChunks = chunks.filter((chunk) =>
    opts.documentId ? chunk.document_id === opts.documentId : readyIds.has(chunk.document_id),
  );

  if (!readyChunks.length) {
    console.log("No ready chunks found. Ingest at least one document before benchmarking retrieval.");
    console.log(`Checked ${chunks.length} chunk(s). Data directory can be changed with DATA_DIR.`);
    return;
  }

  const queries = opts.queries.length ? opts.queries : defaultQueries(readyChunks);
  if (!queries.length) {
    console.log("Ready chunks exist, but no useful default queries could be derived.");
    console.log('Pass one or more queries with --query "your question".');
    return;
  }

  console.log("Retrieval benchmark");
  console.log(`mode=${opts.mode} top_k=${opts.topK} ready_chunks=${readyChunks.length}`);
  if (opts.documentId) console.log(`document_id=${opts.documentId}`);
  console.log("");

  const totals: number[] = [];
  for (const query of queries) {
    let result: Awaited<ReturnType<typeof searchChunksWithMeta>>;
    try {
      result = await searchChunksWithMeta({
        query,
        mode: opts.mode,
        topK: opts.topK,
        documentId: opts.documentId,
      });
    } catch (error) {
      console.log(`Query: ${query}`);
      console.log(`  failed=${error instanceof Error ? error.message : String(error)}`);
      console.log("");
      continue;
    }
    const { hits, meta } = result;
    totals.push(meta.timing_ms.search_total ?? 0);

    console.log(`Query: ${query}`);
    console.log(
      `  latency=${formatMs(meta.timing_ms.search_total)}ms hits=${hits.length} chunks=${meta.chunk_count} load=${formatMs(meta.timing_ms.load_chunks)}ms vector=${formatMs(meta.timing_ms.vector_search)}ms lexical=${formatMs(meta.timing_ms.lexical_search)}ms fuse=${formatMs(meta.timing_ms.fuse_results)}ms`,
    );

    for (const [index, hit] of hits.slice(0, 3).entries()) {
      const title = hit.metadata.section_title ? ` section="${hit.metadata.section_title}"` : "";
      console.log(
        `  #${index + 1} score=${hit.rrf_score.toFixed(4)} doc=${hit.metadata.document_id} chunk=${hit.metadata.ordinal} pages=${hit.metadata.page_start}-${hit.metadata.page_end}${title}`,
      );
      console.log(`     ${compact(hit.text)}`);
    }
    console.log("");
  }

  const sorted = [...totals].sort((a, b) => a - b);
  const sum = totals.reduce((acc, value) => acc + value, 0);
  if (!totals.length) {
    console.log(`Summary: queries=${queries.length} completed=0`);
    return;
  }
  const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0;
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
  console.log(
    `Summary: queries=${queries.length} avg=${formatMs(sum / totals.length)}ms p50=${formatMs(p50)}ms p95=${formatMs(p95)}ms`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
