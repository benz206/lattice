# Performance

Rough expectations for the single-process Next.js 16 version.

## Ingestion

| Stage | Notes |
| --- | --- |
| PDF extraction | Best with Poppler `pdftotext`; roughly linear in page count and text density. |
| Chunking/enrichment | Regex and text processing only; typically fast compared with extraction. |
| Hash embeddings | Local and cheap; good for development and deterministic retrieval. |
| Hosted embeddings | Network-bound; controlled by `LATTICE_EMBED_BATCH_SIZE`. |
| Persistence | JSON files under `DATA_DIR`; simple and portable, not tuned for heavy concurrent writes. |

## Querying

Search loads chunk JSON, scores lexical/vector signals in-process, and fuses
rankings. For small and medium local corpora this should be comfortably
interactive. Very large corpora will eventually want a database/vector index
again, but without a separate service boundary.

Answer latency is dominated by the configured LLM endpoint. With
`LATTICE_LLM=stub`, answers are immediate and deterministic. With Ollama or a
hosted OpenAI-compatible provider, latency follows that provider and model.

## Storage

Raw PDFs are preserved in `UPLOAD_DIR`. Extracted pages and chunks are stored as
formatted JSON. Hash embeddings are 256 floats per chunk; hosted embedding
vectors use the provider's native dimension.

## Tuning knobs

- `MAX_UPLOAD_MB` caps uploads.
- `LATTICE_EMBEDDER=hash` avoids network/model costs.
- `LATTICE_EMBEDDER=openrouter` or `openai_compat` enables hosted embeddings.
- `LATTICE_EMBED_BATCH_SIZE` controls hosted embedding batch size.
- `LLM_BACKEND=openai_compat` points answers at an OpenAI-compatible endpoint.
- `LATTICE_LLM=stub` skips LLM calls for demos and deterministic smoke tests.
