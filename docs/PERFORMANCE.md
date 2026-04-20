# Performance

Rough expectations for a single-box Lattice deployment. Numbers below are orders of magnitude — exact figures depend on disk, CPU/GPU, and document content.

## Latency expectations

### Ingestion (per document)

Dominated by embedding throughput.

| Stage | Cost | Notes |
| --- | --- | --- |
| PDF parse (PyMuPDF) | ~50–200 pages/sec | CPU-bound; roughly linear in char count. |
| Chunk + enrich | Tens of ms per 100 chunks | Pure Python, stdlib regex. |
| Embedding — `gte-Qwen2-1.5B-instruct` on CPU | ~5–15 chunks/sec | Batch size 16 by default (`LATTICE_EMBED_BATCH_SIZE`). |
| Embedding — same model on Apple `mps` | ~30–80 chunks/sec | Set `INFERENCE_DEVICE=mps`. |
| Embedding — same model on CUDA | ~150–400 chunks/sec | Set `INFERENCE_DEVICE=cuda`. |
| Vector upsert (Chroma) | <1 ms per chunk amortized | Persists on disk under `VECTOR_STORE_DIR`. |
| BM25 rebuild | Sub-second per 10k chunks | Lazy; only runs on first query after invalidation. |

A 1,000-page document yields roughly 1–3k chunks depending on density — think ~3–10 minutes to ingest on CPU, ~30–90 seconds on a discrete GPU.

### Query (per request)

| Stage | Cost |
| --- | --- |
| Query embedding (1 text) | 50–300 ms on CPU; 10–30 ms on GPU. |
| Chroma k-NN | <20 ms for <100k chunks. |
| BM25 scoring | <50 ms for <100k chunks, in-process. |
| RRF fusion | Microseconds. |
| LLM generation (`Qwen2.5-1.5B-Instruct`, ~200 output tokens) | ~1–3 s on GPU; ~8–25 s on CPU. Switch to `openai_compat` + Ollama to offload. |

End-to-end hybrid search (without the LLM) is typically well under 500 ms per query.

## Storage footprint

| Kind | Size |
| --- | --- |
| SQLite row overhead per chunk | ~300–700 bytes (text-dominated). |
| Chroma vector + metadata per chunk | `dim * 4` bytes + ~300 bytes metadata. For `gte-Qwen2-1.5B` (1536-d), ~6.5 KB per chunk. |
| Raw PDF upload | Preserved as-is in `UPLOAD_DIR`. |

Ballpark: a 10k-chunk corpus embedded with a 1536-d model consumes roughly 60–100 MB of vector store plus a few MB of SQLite.

## Tuning knobs

Env-driven:

- `LATTICE_EMBED_BATCH_SIZE` — bigger batches help on GPU, hurt on tight-RAM CPU boxes. Default `16`.
- `INFERENCE_DEVICE` — `auto` / `cpu` / `mps` / `cuda`.
- `LLM_BACKEND` — `transformers` (in-process), `openai_compat` (offload to Ollama/vLLM), `llama_cpp` (GGUF).
- `LATTICE_LLM_BASE_URL` — point `openai_compat` at a local Ollama (`http://localhost:11434/v1`) or remote endpoint.
- `LATTICE_LLM=stub` / `LATTICE_EMBEDDER=hash` — skip model loads entirely (used by the test suite and the eval harness).
- `MAX_UPLOAD_MB` — server-side cap on single-file uploads.

Code-level constants worth knowing (`app/services/answering.py`):

- `MAX_CONTEXT_CHARS=6000` — prompt cap across all evidence passages, truncated at a word boundary.
- `MIN_TOP_SCORE=0.005` — RRF floor below which we declare insufficient evidence (dual-signal hits bypass this). See `docs/ARCHITECTURE.md` for why this value is so small.
- `top_k=8` (default argument) — number of passages fed to the LLM.

## Evaluation

Run a synthetic-corpus retrieval benchmark (no model downloads required):

```bash
cd backend
source .venv/bin/activate
LATTICE_EMBEDDER=hash LATTICE_LLM=stub python scripts/eval_retrieval.py
```

The script plants answers at known chunks and reports Recall@1/5/10, MRR, and median latency for hybrid, vector-only, and lexical-only modes. It exits non-zero if hybrid Recall@10 drops below `0.5`, which is the floor we treat as "retrieval is usefully working."
