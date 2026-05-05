# Architecture

Lattice is a single Next.js 16 App Router application at the repository root.
The UI lives in `app` and `components`; the API route handlers live in
`app/api`; the ingestion, storage, retrieval, and answering pipeline lives in
`lib/server`.

## Data flow

```text
PDF upload -> POST /api/documents
  -> data/uploads/<id>.pdf
  -> data/lattice.json document row (pending)
  -> background ingestion in the Next.js server
  -> pdftotext extraction
  -> section-aware chunks + summaries + keywords
  -> hash or OpenAI-compatible embeddings
  -> data/pages/<id>.json + data/chunks/<id>.json + data/indexes/<id>.json
  -> document status ready

Question/search -> /api/search or /api/answer
  -> load chunks and retrieval indexes from local JSON
  -> vector score + BM25-style lexical score
  -> reciprocal rank fusion for hybrid mode
  -> rerank/diversify top results
  -> optional OpenAI-compatible chat completion with [E#] citations
```

## Module map

| Path | Responsibility |
| --- | --- |
| `app/api/*` | Next.js route handlers replacing the old backend API. |
| `app/documents/*` | Document library, detail, page, search, and ask views. |
| `app/upload/page.tsx` | PDF upload page. |
| `components/*` | Shared React UI components. |
| `lib/server/settings.ts` | Env and repo-relative path resolution. |
| `lib/server/store.ts` | Local JSON document/page/chunk/index persistence. |
| `lib/server/pdf.ts` | PDF text extraction via `pdftotext`, with a minimal fallback. |
| `lib/server/chunking.ts` | Section-aware chunking, summaries, keywords, document map. |
| `lib/server/embedding.ts` | Hash embeddings by default; OpenAI-compatible embeddings when configured. |
| `lib/server/retrieval-index.ts` | Persisted lexical retrieval index construction and validation. |
| `lib/server/retrieval.ts` | Vector, lexical, hybrid retrieval, and result reranking. |
| `lib/server/answering.ts` | Evidence capping, LLM prompt, citations, confidence scoring. |
| `lib/api.ts` | Client/server fetch helpers and shared response types. |

## Storage layout

```text
data/
├── lattice.json        # document metadata
├── uploads/            # raw PDFs
├── pages/<id>.json     # extracted page text
├── chunks/<id>.json    # retrieval chunks and embeddings
└── indexes/<id>.json   # lexical retrieval index for ready documents
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
and lexical scores for inspection in the UI. Lexical and hybrid searches then
rerank and diversify the candidate set before returning the final `topK` hits.

## Answering

`answerQuery` runs hybrid retrieval, caps evidence to `MAX_CONTEXT_CHARS=6000`,
asks the configured LLM to answer only from evidence, parses `[E#]` citations,
and estimates confidence from retrieval strength plus citation support. Empty or
weak retrieval returns the canonical "Insufficient evidence to answer." result.
