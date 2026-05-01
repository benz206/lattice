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

The stack is now a single **Next.js 16 App Router** application. Route handlers
own upload, ingestion, indexing, retrieval, and answering directly, so there is
no separate backend service to run.

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

1. **Ingest.** PDFs are parsed by the Next.js server using local `pdftotext` when available, split into overlapping section-aware chunks, enriched with a short summary + keywords, and persisted to local JSON data files.
2. **Index.** Each chunk is embedded with a local deterministic hash embedder by default, or an OpenAI-compatible embeddings endpoint when configured. Lexical BM25-style scoring is computed over the same chunks.
3. **Retrieve.** Queries hit both retrievers and fuse via reciprocal rank fusion (RRF) with α-weighted blending. Vector-only / lexical-only modes are also exposed for inspection.
4. **Answer.** The top-k passages are capped to a context budget and passed to a local LLM (default `Qwen2.5-1.5B-Instruct`), which must cite supporting passages with `[E#]`. Weak retrieval or an explicit `INSUFFICIENT_EVIDENCE` reply maps to a canonical "not enough evidence" response.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full pipeline and [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) for latency/storage expectations and tuning knobs.

## Prerequisites

- Bun
- Node.js 20.9+ through Bun/Next.js
- `pdftotext` from Poppler is recommended for high-quality PDF extraction

## Quickstart

### 1. Copy env config

```bash
cp .env.example .env
```

### 2. One-shot setup

```bash
bash scripts/setup.sh
```

The script installs the Next.js app dependencies with Bun.

### 3. Run the app

```bash
bash scripts/dev.sh
```

Lattice will be available at `http://localhost:3000`.

## Dev commands

| Command                              | Description                           |
| ------------------------------------ | ------------------------------------- |
| `bash scripts/setup.sh`              | Install dependencies with Bun         |
| `bash scripts/dev.sh`                | Run the Next.js app                   |
| `cd frontend && bun run typecheck`   | TypeScript type-check                 |
| `cd frontend && bun run lint`        | ESLint                                |

## Configuration

Everything is env-driven through `.env` (see `.env.example` for the full list). The knobs that matter most in practice:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBEDDING_MODEL` | `hash-local` | Hosted embedding model name when using OpenAI-compatible embeddings. |
| `LATTICE_EMBEDDER` | `hash` | Embedder backend: `hash`, `openrouter`, or `openai_compat`. |
| `LATTICE_EMBEDDING_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible embeddings endpoint. |
| `LATTICE_EMBEDDING_API_KEY` | unset | Bearer token for hosted embedding providers. Falls back to `LATTICE_LLM_API_KEY` if unset. |
| `LLM_MODEL` | `qwen2.5:1.5b-instruct` | Model used for answer generation. |
| `LLM_BACKEND` | `openai_compat` | `openai_compat` or `stub`. |
| `LATTICE_LLM_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible endpoint (Ollama by default). |
| `LATTICE_LLM_API_KEY` | unset | Bearer token for hosted OpenAI-compatible providers. |
| `LATTICE_LLM_HTTP_REFERER` | unset | Optional `HTTP-Referer` header for OpenRouter rankings/analytics. |
| `LATTICE_LLM_APP_TITLE` | `Lattice` | Optional `X-Title` header for OpenRouter rankings/analytics. |
| `INFERENCE_DEVICE` | `auto` | `cpu` / `mps` / `cuda` / `auto`. |
| `MAX_UPLOAD_MB` | `200` | Server-side upload cap. |
| `LATTICE_EMBEDDER=hash` | `hash` | Use the deterministic local embedder. |
| `LATTICE_LLM=stub` | unset | Skip the real LLM and return deterministic cited answers. |

## Running a local LLM via Ollama

Lattice talks to any OpenAI-compatible `/v1/chat/completions` endpoint, so [Ollama](https://ollama.com) is the easiest way to run a local model:

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

When switching embedding models, re-index existing documents so stored chunk
embeddings are regenerated with the new model dimensions.

## Project structure

```text
lattice/
├── frontend/             # Next.js 16 app (UI, API routes, server pipeline)
├── docs/                 # ARCHITECTURE.md, PERFORMANCE.md
└── scripts/              # setup.sh, dev.sh
```

## Limitations

- **Single-process storage.** Local JSON data files are simple and portable, but not intended for highly concurrent multi-worker deployments.
- **PDF only.** Upload handling still accepts PDF files only.
- **Extraction quality.** Install Poppler so `pdftotext` is available; the built-in fallback is only a last resort.
- **Small-model ceiling.** `qwen2.5:1.5b-instruct` is intentionally small; point `LLM_MODEL` at a larger OpenAI-compatible model to compare.
