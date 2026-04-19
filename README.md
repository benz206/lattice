# Lattice

Evidence retrieval from long documents — a full-stack monorepo.

## Overview

Lattice lets you upload large documents (PDFs, etc.) and run semantic + lexical search over them to retrieve grounded evidence passages. The backend is a Python FastAPI service; the frontend is a Next.js 15 App Router application.

## Prerequisites

- Python 3.11+
- Node 20+
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

| Command | Description |
|---|---|
| `bash scripts/setup.sh` | Create venv, install all deps |
| `bash scripts/dev.sh` | Run backend + frontend concurrently |
| `cd backend && pytest` | Run backend tests |
| `cd frontend && npm run typecheck` | TypeScript type-check |
| `cd frontend && npm run lint` | ESLint |

## Project structure

```
lattice/
├── backend/        # FastAPI app (Python)
├── frontend/       # Next.js 15 app (TypeScript)
├── docs/           # Architecture docs
└── scripts/        # Dev/setup shell scripts
```
