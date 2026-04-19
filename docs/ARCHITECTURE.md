# Architecture

## Overview

Lattice is a full-stack evidence-retrieval system that ingests long documents, indexes them with hybrid search, and uses a local LLM to produce grounded answers. The backend is a Python FastAPI service; the frontend is Next.js 15.

## Ingestion Pipeline

Documents uploaded via the API are persisted to disk, registered in SQLite, and queued for processing. Each processing job extracts text, runs chunking, embeds chunks, and populates both the BM25 index and the vector store.

## Chunking & Document Map

Text is split into overlapping chunks whose boundaries respect paragraph and sentence structure. A document map tracks the byte/page offsets of each chunk so retrieved passages can be highlighted in the original document.

## Retrieval (Lexical + Vector + Hybrid)

Lexical retrieval uses BM25 over the full chunk corpus. Vector retrieval queries the ChromaDB collection with the query embedding. Hybrid retrieval merges both ranked lists using reciprocal rank fusion (RRF) before optional reranking.

## Answering Pipeline

Retrieved top-k chunks are assembled into a prompt context. The LLM adapter generates an answer with inline citations referencing chunk IDs. The response includes both the answer text and the supporting passages.

## Model Adapters

Adapters abstract over three inference backends — `transformers` (HuggingFace), `llama_cpp` (GGUF), and `openai_compat` (any OpenAI-compatible API). The active backend is selected via the `LLM_BACKEND` env var at startup.

## Storage Layout

```
backend/data/
├── uploads/        # Raw uploaded files
├── app.db          # SQLite — documents, chunks, jobs
└── vectorstore/    # ChromaDB persistent store
```

All paths are configurable through environment variables.

## Extensibility Notes

New retrieval strategies can be added by implementing the `RetrieverProtocol` interface without modifying the answering pipeline. New LLM backends require only a new adapter module dropped into `app/adapters/`.
