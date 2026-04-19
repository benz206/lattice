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

## Prerequisites

- Python 3.11+
- Node 20+
- (Optional) CUDA/MPS GPU for faster inference

## Quickstart

### 1. Copy env config

```bash
cp .env.example .env
````

### 2. One-shot setup (venv + deps)

```bash
bash scripts/setup.sh
```

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
npm run dev
```

## Dev commands

| Command                            | Description                           |
| ---------------------------------- | ------------------------------------- |
| `bash scripts/setup.sh`            | Create venv and install dependencies  |
| `bash scripts/dev.sh`              | Run backend and frontend concurrently |
| `cd backend && pytest`             | Run backend tests                     |
| `cd frontend && npm run typecheck` | TypeScript type-check                 |
| `cd frontend && npm run lint`      | ESLint                                |

## Project structure

```text
lattice/
├── backend/        # FastAPI app for ingestion, indexing, and retrieval
├── frontend/       # Next.js 15 app for upload and evidence exploration
├── docs/           # Architecture and design docs
└── scripts/        # Dev and setup shell scripts
```

## Current focus

Lattice is currently focused on the retrieval side of long-document QA:

* ingesting large files
* chunking and indexing them efficiently
* combining semantic and lexical search
* returning grounded passages for downstream reasoning

The broader goal is to make weak models more useful on hard document tasks by improving the evidence they see first.
