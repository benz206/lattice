# Lattice

Small-model evidence retrieval for long documents.

Lattice is a full-stack monorepo for turning large documents into grounded, searchable evidence. It is designed around a simple idea: instead of asking a weak model to “understand” a 1000-page book end-to-end, first build a strong retrieval layer that finds the exact passages needed to answer hard questions.

## Overview

Lattice lets you upload long documents such as PDFs, index them, and run semantic + lexical retrieval to surface relevant evidence passages. The goal is not just document search, but evidence-backed reasoning: helping smaller, cheaper models answer multi-step questions by narrowing the problem to the most relevant text.

This makes Lattice useful for workflows like:

- answering hard questions over very long technical documents
- retrieving supporting passages before generation
- testing how far a small model can go when given strong evidence
- comparing grounded answers against shallow keyword matching

The stack consists of:

- a **Python FastAPI backend** for ingestion, indexing, and retrieval
- a **Next.js 15 App Router frontend** for upload, search, and evidence inspection

## Why Lattice?

Long documents are hard for small models. Even when the answer is present, weak models often fail because they:

- cannot hold enough context at once
- miss relevant passages hidden far apart in the document
- confuse vague semantic similarity with actual evidence
- produce plausible but weakly grounded answers

Lattice is built to address that by combining retrieval methods and surfacing the specific passages a model should use as evidence.

## Core idea

Instead of asking:

> “Can a 1.5B model understand this entire book?”

Lattice asks:

> “Can a 1.5B model answer this question if we first retrieve the right evidence?”

That shift is the project’s core framing.

## How it works

1. **Ingest.** PDFs are parsed with PyMuPDF, split into overlapping section-aware chunks (page-span aware), enriched with a short summary + keywords, and persisted to SQLite.
2. **Index.** Each chunk is embedded (default `gte-Qwen2-1.5B-instruct`) and upserted into a local ChromaDB store. A BM25 index is rebuilt lazily from the same chunks.
3. **Retrieve.** Queries hit both retrievers and fuse via reciprocal rank fusion (RRF) with α-weighted blending. Vector-only / lexical-only modes are also exposed for inspection.
4. **Answer.** The top-k passages are capped to a context budget and passed to a local LLM (default `Qwen2.5-1.5B-Instruct`), which must cite supporting passages with `[E#]`. Weak retrieval or an explicit `INSUFFICIENT_EVIDENCE` reply maps to a canonical "not enough evidence" response.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full pipeline and [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) for latency/storage expectations and tuning knobs.

## Prerequisites

- Python 3.11+
- Node 20+ (or [Bun](https://bun.sh) — preferred; the scripts auto-detect it)
- (Optional) CUDA/MPS GPU for faster inference

## Quickstart

### 1. Copy env config

```bash
cp .env.example .env
```

### 2. One-shot setup (venv + deps)

```bash
bash scripts/setup.sh
```

The script creates `backend/.venv`, installs Python deps, and installs frontend deps with `bun` when available (falls back to `npm`).

### 3. Run both services concurrently

```bash
bash scripts/dev.sh
```

The backend will be available at `http://localhost:8000` and the frontend at `http://localhost:3000`.

---

## Running services individually

### Backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
bun run dev           # or: npm run dev
```

## Dev commands

| Command                              | Description                           |
| ------------------------------------ | ------------------------------------- |
| `bash scripts/setup.sh`              | Create venv and install dependencies  |
| `bash scripts/dev.sh`                | Run backend and frontend concurrently |
| `cd backend && pytest`               | Run backend tests                     |
| `cd backend && python scripts/eval_retrieval.py` | Run the synthetic-corpus retrieval benchmark |
| `cd frontend && bun run typecheck`   | TypeScript type-check (or `npm run typecheck`) |
| `cd frontend && bun run lint`        | ESLint (or `npm run lint`)            |

## Configuration

Everything is env-driven through `.env` (see `.env.example` for the full list). The knobs that matter most in practice:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBEDDING_MODEL` | `Alibaba-NLP/gte-Qwen2-1.5B-instruct` | HuggingFace model id for the embedder. |
| `LATTICE_EMBEDDER` | unset | Optional embedder backend override: `openrouter`, `openai_compat`, or `hash`. |
| `LATTICE_EMBEDDING_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible embeddings endpoint. |
| `LATTICE_EMBEDDING_API_KEY` | unset | Bearer token for hosted embedding providers. Falls back to `LATTICE_LLM_API_KEY` if unset. |
| `LLM_MODEL` | `Qwen/Qwen2.5-1.5B-Instruct` | Model used for answer generation. |
| `LLM_BACKEND` | `transformers` | `transformers`, `openai_compat`, or `llama_cpp`. |
| `LATTICE_LLM_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible endpoint (Ollama by default). |
| `LATTICE_LLM_API_KEY` | unset | Bearer token for hosted OpenAI-compatible providers. |
| `LATTICE_LLM_HTTP_REFERER` | unset | Optional `HTTP-Referer` header for OpenRouter rankings/analytics. |
| `LATTICE_LLM_APP_TITLE` | `Lattice` | Optional `X-Title` header for OpenRouter rankings/analytics. |
| `INFERENCE_DEVICE` | `auto` | `cpu` / `mps` / `cuda` / `auto`. |
| `MAX_UPLOAD_MB` | `200` | Server-side upload cap. |
| `LATTICE_EMBEDDER=hash` | unset | Skip the real embedder; use the deterministic hash fallback. Used by the test suite and eval harness. |
| `LATTICE_LLM=stub` | unset | Skip the real LLM; use the deterministic stub backend. |

## Running a local LLM via Ollama

Lattice talks to any OpenAI-compatible `/v1/chat/completions` endpoint, so [Ollama](https://ollama.com) is the easiest way to run a local model without PyTorch:

```bash
ollama pull qwen2.5:1.5b-instruct
ollama serve
```

Then in `.env`:

```bash
LLM_BACKEND=openai_compat
LLM_MODEL=qwen2.5:1.5b-instruct
LATTICE_LLM_BASE_URL=http://localhost:11434/v1
```

The same setting works for vLLM (`/v1`), llama.cpp's server, LM Studio, or the OpenAI API itself (set `LATTICE_LLM_API_KEY`).

## Running a free OpenRouter model

OpenRouter exposes an OpenAI-compatible API, so use the same `openai_compat` backend. Create an OpenRouter API key, then set:

```bash
LLM_BACKEND=openai_compat
LLM_MODEL=openai/gpt-oss-120b:free
LATTICE_LLM_BASE_URL=https://openrouter.ai/api/v1
LATTICE_LLM_API_KEY=sk-or-v1-your-openrouter-key
LATTICE_LLM_APP_TITLE=Lattice
```

`LATTICE_LLM_HTTP_REFERER` is optional, but you can set it to your deployed app URL if you have one.

## Running free OpenRouter embeddings

Lattice can also send embeddings to OpenRouter through the same OpenAI-compatible API style:

```bash
LATTICE_EMBEDDER=openrouter
EMBEDDING_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2:free
LATTICE_EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
LATTICE_EMBEDDING_API_KEY=sk-or-v1-your-openrouter-key
```

If `LATTICE_EMBEDDING_API_KEY` is unset, Lattice reuses `LATTICE_LLM_API_KEY`.

When switching embedding models, Lattice writes to a model-specific Chroma collection to avoid dimension conflicts with older vectors. Re-index existing documents so the new collection is populated.

## Running tests

```bash
cd backend
source .venv/bin/activate
pytest
```

The suite forces `LATTICE_EMBEDDER=hash` and uses the `StubLlm`, so no model downloads are needed. `backend/tests/conftest.py` redirects `DATA_DIR`/`SQLITE_PATH`/`VECTOR_STORE_DIR` to a tmpdir and provides a `reset_db` fixture that wipes SQLite, the Chroma collection, and the BM25 cache between tests.

## Evaluation

A synthetic-corpus retrieval benchmark ships with the repo:

```bash
cd backend
source .venv/bin/activate
LATTICE_EMBEDDER=hash LATTICE_LLM=stub python scripts/eval_retrieval.py
```

It generates a 2-document PDF corpus with planted facts, ingests it, and reports Recall@1/5/10, MRR, and median latency per mode. The script exits non-zero if hybrid Recall@10 drops below `0.5`.

## Project structure

```text
lattice/
├── backend/
│   ├── app/              # FastAPI app (routes, adapters, services, models)
│   ├── scripts/          # Eval harness
│   └── tests/            # pytest suite + PDF fixture builder
├── frontend/             # Next.js 15 App Router app (src/app, src/components, src/lib)
├── docs/                 # ARCHITECTURE.md, PERFORMANCE.md
└── scripts/              # setup.sh, dev.sh
```

## Limitations

- **Single-process indices.** BM25 lives in-process and rebuilds from SQLite; Chroma is a local `PersistentClient`. Neither is sharded for multi-worker deployments.
- **PDF only.** `pdf_parser` uses PyMuPDF; swap the parser in `app/services/pdf_parser.py` for other formats — the rest of the pipeline is format-agnostic.
- **Cold-start latency.** The first embed/answer after startup pays the model-load cost; subsequent calls reuse the cached instances.
- **Small-model ceiling.** `Qwen2.5-1.5B-Instruct` is intentionally small; expect limits on multi-step reasoning even when retrieval is perfect. Point `LLM_MODEL` at a larger model to compare.
