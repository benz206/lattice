# Architecture

Lattice is a two-tier monorepo: a Python FastAPI backend that owns ingestion, indexing, retrieval, and answering; and a Next.js 15 frontend that drives the upload / browse / search / ask UX. Everything runs locally on SQLite + on-disk ChromaDB — no external services required.

## Data flow

```
PDF upload ──▶ POST /api/documents                 (frontend/src/app/upload)
                    │
                    ▼
               uploads/<id>.pdf + SQLite row (status=pending)
                    │   BackgroundTasks
                    ▼
         services.ingestion.ingest_document
                    │
     ┌──────────────┼──────────────────────────┐
     ▼              ▼                          ▼
 pdf_parser   chunker + chunk_enrich     document_map
 (PyMuPDF)   (section-aware, overlap)   (section outline)
     │              │                          │
     └──────────────┴──────────────────────────┘
                    │  persist: pages, chunks
                    ▼
        adapters.embedder ──▶ services.vector_store (Chroma, cosine)
                    │
                    └─────▶ services.lexical_index  (BM25, lazy rebuild)
                    │
               status=ready


QUESTION ──▶ POST /api/answer         (frontend/src/app/documents/[id]/ask)
                    │
                    ▼
        services.retrieval.hybrid_search   (vector + BM25 → RRF)
                    │
                    ▼
        services.answering.answer_query
           ├─ cap evidence to MAX_CONTEXT_CHARS
           ├─ build_prompt → adapters.llm.generate
           ├─ parse_citations [E#]
           └─ estimate_confidence
                    │
                    ▼
        AnswerOut (answer + citations + evidence + confidence)
```

## Backend module map

| Path | Responsibility |
| --- | --- |
| `app/main.py` | FastAPI app factory, lifespan (dirs + DB init + startup log), CORS, `/api` mount. |
| `app/core/config.py` | `pydantic-settings` `Settings` loaded from `.env`; paths resolved relative to repo root. |
| `app/core/logging.py` | stdlib logging format. |
| `app/db/session.py` | Async SQLAlchemy engine (`sqlite+aiosqlite`), `PRAGMA foreign_keys=ON`, `init_db`, `get_session` dep. |
| `app/models/` | `Document`, `Page`, `Chunk` ORM models with `ondelete=CASCADE`. |
| `app/schemas/` | Pydantic request/response schemas. |
| `app/services/pdf_parser.py` | PyMuPDF text + metadata extraction. |
| `app/services/chunker.py` | Section-aware, paragraph/sentence-greedy chunker with sentence-aligned overlap and page-span tracking. |
| `app/services/chunk_enrich.py` | Per-chunk summary (first 1–2 sentences) + keyword extraction (TF with stopword/length filters). |
| `app/services/document_map.py` | Groups consecutive chunks into a section outline for the UI. |
| `app/services/ingestion.py` | End-to-end pipeline; state machine `pending → processing → ready / failed`. |
| `app/services/vector_store.py` | Thin wrapper over ChromaDB `PersistentClient` (cosine space). |
| `app/services/lexical_index.py` | Process-wide lazy `BM25Okapi` singleton, rebuilt from SQLite on invalidation. |
| `app/services/retrieval.py` | `hybrid_search` / `vector_only_search` / `lexical_only_search`; `reciprocal_rank_fusion` with α weighting. |
| `app/services/answering.py` | Prompt build, `[E#]` parse, insufficient-evidence policy, confidence heuristic. |
| `app/adapters/embedder.py` | `SentenceTransformerEmbedder` (prod, lazy) + `HashEmbedder` (deterministic, for tests). |
| `app/adapters/llm.py` | `StubLlm`, `TransformersLlm`, `OpenAICompatLlm` (Ollama/vLLM/OpenAI), `LlamaCppLlm`. |
| `app/api/routes/` | `health`, `documents`, `search`, `answer`. |

## Ingestion pipeline

`services.ingestion.ingest_document` runs under `BackgroundTasks`. It:

1. Marks the document `processing`.
2. Parses PDF pages + metadata (`pdf_parser`).
3. Persists `Page` rows, sets `num_pages`.
4. Chunks the concatenated page text with `chunker.chunk_document` — section headings detected via markdown, ALL-CAPS, numbered, and blank-flanked heuristics; chunks hold `page_start/end`, `char_start/end`, `section_title`, `overlap_prefix_len`.
5. Enriches each chunk with a short summary and top keywords.
6. Persists `Chunk` rows, then builds and stores the document map on the `Document` row.
7. Embeds all chunk texts (batch) and upserts `(chunk_id, embedding, metadata, document)` into Chroma.
8. Invalidates the BM25 index so the next query rebuilds from SQLite.
9. Marks the document `ready`.

On any exception: rollback, best-effort vector cleanup, `status=failed` with the error string. The entire step is idempotent at the document level via re-ingest.

## Retrieval

`services.retrieval`:

- **Vector path:** embed the query (`kind="query"` — adds the Qwen instruction prefix automatically for Qwen-family models), `vector_store.query` with `top_k`, returns cosine similarity (= `1 - distance`). Optional `document_id` filter is applied server-side.
- **Lexical path:** `LexicalIndex.query` rebuilds from SQLite on first use after invalidation, tokenizes (lowercase, drop <2-char tokens and stopwords), scores with `BM25Okapi`, filters by `document_id`.
- **Hybrid fusion:** `reciprocal_rank_fusion` with the standard `k=60`. `_weighted_rrf(alpha)` blends with `alpha` vector-weight and `1-alpha` lexical-weight. For each `chunk_id` we retain both the vector and lexical raw scores so callers can reason about dual-signal hits.

## Answering

`services.answering.answer_query(query, top_k=8, document_id=None)`:

1. `hybrid_search(alpha=0.5)` → up to `top_k` `FusedHit`s.
2. Convert hits to `EvidencePassage` and cap cumulative text at `MAX_CONTEXT_CHARS=6000` (truncating the trailing passage at a word boundary).
3. **Insufficient-evidence gate:** if `len(passages) < MIN_HITS` OR (`max_rrf < MIN_TOP_SCORE=0.005` AND no hit has both a positive `vector_score` and a positive `lexical_score`), return a canonical insufficient response — evidence is still populated for transparency.
4. Build a chat-style prompt (`build_prompt`) instructing the LLM to answer only from the EVIDENCE section, cite with `[E#]`, and emit literal `INSUFFICIENT_EVIDENCE` if it can't.
5. Call the LLM via `LlmProtocol.generate`. If the response is exactly `INSUFFICIENT_EVIDENCE`, return the canonical insufficient response.
6. `parse_citations` extracts unique `[E#]` tokens (ignoring out-of-range indices) and resolves them to `Citation`s.
7. `estimate_confidence` = `clip(max_rrf_score * 5, 0, 1) * (1.0 if any citation else 0.5)`.

**Why `MIN_TOP_SCORE=0.005`?** RRF with `k=60` caps theoretical scores near `1/(60+1) ≈ 0.0164` per list. The threshold filters essentially-empty retrieval without flagging weak-but-real matches; the dual-signal exception rescues cases where both retrievers agreed at low absolute RRF.

## Adapters

`EmbedderProtocol` (`embed(texts, kind) → np.ndarray`) and `LlmProtocol` (`async generate(messages, ...) → str`). Each adapter lazy-imports its heavy dependency so `import app` stays cheap and tests can force the stub path with `LATTICE_EMBEDDER=hash` / `LATTICE_LLM=stub`. `get_embedder` and `get_llm` are process-wide `lru_cache` singletons.

LLM backends (selected by `LLM_BACKEND` env, or `LATTICE_LLM=stub` override):

| Backend | Class | Notes |
| --- | --- | --- |
| `transformers` | `TransformersLlm` | HuggingFace causal LM, `apply_chat_template` when available. |
| `openai_compat` | `OpenAICompatLlm` | `httpx` against `/v1/chat/completions`; default base URL is Ollama `http://localhost:11434/v1`. |
| `llama_cpp` | `LlamaCppLlm` | GGUF path via `LATTICE_LLM_GGUF_PATH`. |
| `stub` | `StubLlm` | Deterministic; parses `[E1] (chunk=...)` header from the prompt. Used in tests. |

## Storage layout

```
backend/data/
├── uploads/          # Raw uploaded PDFs, keyed by document id
├── app.db            # SQLite: documents, pages, chunks
└── vectorstore/      # ChromaDB PersistentClient state
```

All paths are env-configurable (`DATA_DIR`, `UPLOAD_DIR`, `SQLITE_PATH`, `VECTOR_STORE_DIR`). Paths are resolved relative to the repo root so `cd backend && uvicorn ...` and `bash scripts/dev.sh` both land in the same tree.

## Insufficient-evidence policy

The answering layer is aggressive about saying "I don't know":

- **No retrieval signal** → canonical insufficient response, `confidence=0.0`, evidence list still surfaced.
- **LLM emits `INSUFFICIENT_EVIDENCE`** → same.
- **LLM answers without any `[E#]` citation** → answer is returned as-is, but `estimate_confidence` halves the base score, so the UI bands it as low confidence.

The frontend maps `confidence` to three bands (`< 0.4` low, `< 0.75` medium, ≥ `0.75` high) shown on `/documents/[id]/ask`.

## Extensibility

- **New retrieval strategies**: add a function that returns `list[FusedHit]`; `app/api/routes/search.py` switches on `mode`.
- **New LLM backend**: implement `LlmProtocol` in `app/adapters/llm.py`, dispatch from `get_llm` via `LLM_BACKEND`.
- **New embedder**: implement `EmbedderProtocol` in `app/adapters/embedder.py`, dispatch from `get_embedder` via `LATTICE_EMBEDDER`.
- **Non-PDF inputs**: `pdf_parser.extract_pages` returns `list[PageText]`; swap in a different parser with the same shape and the rest of the pipeline is unaware.
