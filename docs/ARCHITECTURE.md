# Architecture

Lattice is a single Next.js 16 App Router application. The UI lives in
`frontend/src/app` and `frontend/src/components`; the API and retrieval pipeline
live in `frontend/src/app/api` plus `frontend/src/lib/server`.

## Data flow

```text
PDF upload -> POST /api/documents
  -> data/uploads/<id>.pdf
  -> data/lattice.json document row (pending)
  -> background ingestion in the Next.js server
  -> pdftotext extraction
  -> section-aware chunks + summaries + keywords
  -> hash or OpenAI-compatible embeddings
  -> data/pages/<id>.json + data/chunks/<id>.json
  -> document status ready

Question/search -> /api/search or /api/answer
  -> load chunks from local JSON
  -> vector score + BM25-style lexical score
  -> reciprocal rank fusion for hybrid mode
  -> optional OpenAI-compatible chat completion with [E#] citations
```

## Module map

| Path | Responsibility |
| --- | --- |
| `frontend/src/app/api/*` | Next.js route handlers replacing the old backend API. |
| `frontend/src/lib/server/settings.ts` | Env and repo-relative path resolution. |
| `frontend/src/lib/server/store.ts` | Local JSON document/page/chunk persistence. |
| `frontend/src/lib/server/pdf.ts` | PDF text extraction via `pdftotext`, with a minimal fallback. |
| `frontend/src/lib/server/chunking.ts` | Section-aware chunking, summaries, keywords, document map. |
| `frontend/src/lib/server/embedding.ts` | Hash embeddings by default; OpenAI-compatible embeddings when configured. |
| `frontend/src/lib/server/retrieval.ts` | Vector, lexical, and hybrid retrieval. |
| `frontend/src/lib/server/answering.ts` | Evidence capping, LLM prompt, citations, confidence scoring. |
| `frontend/src/lib/api.ts` | Client/server fetch helpers and shared response types. |

## Storage layout

```text
data/
├── lattice.json       # document metadata
├── uploads/           # raw PDFs
├── pages/<id>.json    # extracted page text
└── chunks/<id>.json   # retrieval chunks and embeddings
```

`DATA_DIR` and `UPLOAD_DIR` can override the defaults. Relative paths resolve
from the repository root.

## Runtime choices

- Next.js 16 route handlers run on the Node.js runtime.
- Bun is the package manager.
- `LATTICE_EMBEDDER=hash` is the local default and needs no model download.
- `LATTICE_EMBEDDER=openrouter` or `openai_compat` sends embeddings to a
  compatible `/v1/embeddings` endpoint.
- `LLM_BACKEND=openai_compat` sends answers to a compatible
  `/v1/chat/completions` endpoint such as Ollama, vLLM, LM Studio, OpenRouter,
  or OpenAI.
- `LATTICE_LLM=stub` returns deterministic cited answers without an LLM call.

## Retrieval

Lexical retrieval tokenizes lowercased words, removes common stopwords, and
computes a BM25-style score over the loaded chunks. Vector retrieval embeds the
query and compares cosine similarity against stored chunk embeddings. Hybrid
mode fuses both ranked lists with reciprocal rank fusion and keeps raw vector
and lexical scores for inspection in the UI.

## Answering

`answerQuery` runs hybrid retrieval, caps evidence to `MAX_CONTEXT_CHARS=6000`,
asks the configured LLM to answer only from evidence, parses `[E#]` citations,
and estimates confidence from retrieval strength plus citation support. Empty or
weak retrieval returns the canonical "Insufficient evidence to answer." result.
