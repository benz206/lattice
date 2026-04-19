"""Embedding adapters for Lattice retrieval.

Provides a minimal protocol and two implementations:
  * ``SentenceTransformerEmbedder`` — the production path, lazy-loaded.
  * ``HashEmbedder`` — deterministic, stdlib-only fallback used in tests.

Both produce shape ``(N, dim)`` float32 arrays, L2-normalized row-wise.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from functools import lru_cache
from typing import Literal, Protocol, runtime_checkable

import numpy as np

from app.core.config import settings

_QUERY_INSTRUCTION_PREFIX = (
    "Instruct: Given a query, retrieve relevant documents\nQuery: "
)

_TOKEN_RE = re.compile(r"\W+")

logger = logging.getLogger(__name__)


@runtime_checkable
class EmbedderProtocol(Protocol):
    """Protocol for embedding backends used by the retrieval stack."""

    @property
    def name(self) -> str: ...

    @property
    def dim(self) -> int: ...

    def embed(
        self,
        texts: list[str],
        *,
        kind: Literal["query", "passage"] = "passage",
    ) -> np.ndarray: ...


def _l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    return (vectors / norms).astype(np.float32)


class SentenceTransformerEmbedder:
    """Production embedder backed by ``sentence_transformers.SentenceTransformer``.

    The model is lazy-loaded on first call so that importing this module is cheap
    and does not require the heavy dependency to be installed.
    """

    def __init__(self, model_name: str | None = None, device: str | None = None) -> None:
        self._model_name = model_name or settings.embedding_model
        self._device_pref = device or settings.inference_device
        self._batch_size = max(1, int(settings.embed_batch_size))
        self._model: object | None = None
        self._dim: int | None = None

    @property
    def name(self) -> str:
        return self._model_name

    @property
    def dim(self) -> int:
        self._ensure_loaded()
        assert self._dim is not None
        return self._dim

    def _select_device(self) -> str:
        pref = (self._device_pref or "auto").lower()
        if pref != "auto":
            return pref
        try:
            import torch  # type: ignore[import-not-found]

            if torch.cuda.is_available():
                return "cuda"
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
        except Exception:  # noqa: BLE001
            pass
        return "cpu"

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
        except ImportError as exc:  # pragma: no cover - exercised only in prod envs
            raise RuntimeError(
                "sentence-transformers is not installed; install it or set "
                "LATTICE_EMBEDDER=hash to use the test embedder."
            ) from exc
        device = self._select_device()
        started_at = time.perf_counter()
        logger.info(
            "embedder load start model=%s device=%s",
            self._model_name,
            device,
        )
        model = SentenceTransformer(self._model_name, device=device)
        self._model = model
        # Try to introspect dimension without running a forward pass.
        dim = getattr(model, "get_sentence_embedding_dimension", lambda: None)()
        if not isinstance(dim, int) or dim <= 0:
            # Fallback: run one short forward pass.
            probe = model.encode(["x"], normalize_embeddings=True)
            probe = np.asarray(probe)
            dim = int(probe.shape[-1])
        self._dim = int(dim)
        logger.info(
            "embedder load complete model=%s device=%s dim=%d elapsed_s=%.2f",
            self._model_name,
            device,
            self._dim,
            time.perf_counter() - started_at,
        )

    def embed(
        self,
        texts: list[str],
        *,
        kind: Literal["query", "passage"] = "passage",
    ) -> np.ndarray:
        self._ensure_loaded()
        assert self._model is not None

        is_qwen_like = "qwen" in self._model_name.lower()
        if kind == "query" and is_qwen_like:
            prepared = [_QUERY_INSTRUCTION_PREFIX + (t or "") for t in texts]
        else:
            prepared = [t or "" for t in texts]

        lengths = [len(text) for text in prepared]
        avg_chars = (sum(lengths) / len(lengths)) if lengths else 0.0
        max_chars = max(lengths, default=0)
        started_at = time.perf_counter()
        logger.info(
            "embed start model=%s kind=%s count=%d batch_size=%d avg_chars=%.1f max_chars=%d",
            self._model_name,
            kind,
            len(prepared),
            self._batch_size,
            avg_chars,
            max_chars,
        )
        vectors = self._model.encode(  # type: ignore[attr-defined]
            prepared,
            batch_size=self._batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=True,
        )
        arr = np.asarray(vectors, dtype=np.float32)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        logger.info(
            "embed complete model=%s kind=%s count=%d batch_size=%d dim=%d elapsed_s=%.2f",
            self._model_name,
            kind,
            len(prepared),
            self._batch_size,
            int(arr.shape[-1]) if arr.size else 0,
            time.perf_counter() - started_at,
        )
        return arr


class HashEmbedder:
    """Deterministic, stdlib-only embedder used for tests.

    Each text is tokenized on ``\\W+``, each token hashed with blake2b, and the
    hashed index accumulated into a fixed-width vector. Finally L2-normalized.
    """

    def __init__(self, dim: int = 256, model_name: str = "hash-test-embedder") -> None:
        if dim <= 0 or (dim & (dim - 1)) != 0:
            raise ValueError("dim must be a positive power of two")
        self._dim = dim
        self._name = model_name

    @property
    def name(self) -> str:
        return self._name

    @property
    def dim(self) -> int:
        return self._dim

    def _vectorize(self, text: str) -> np.ndarray:
        vec = np.zeros(self._dim, dtype=np.float32)
        if not text:
            return vec
        tokens = [t for t in _TOKEN_RE.split(text.lower()) if t]
        if not tokens:
            return vec
        mask = self._dim - 1
        for tok in tokens:
            digest = hashlib.blake2b(tok.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(digest, "big") & mask
            vec[idx] += 1.0
        return vec

    def embed(
        self,
        texts: list[str],
        *,
        kind: Literal["query", "passage"] = "passage",
    ) -> np.ndarray:
        # ``kind`` is accepted for API parity but has no effect for the hash embedder.
        del kind
        if not texts:
            return np.zeros((0, self._dim), dtype=np.float32)
        matrix = np.stack([self._vectorize(t or "") for t in texts], axis=0)
        return _l2_normalize(matrix)


@lru_cache(maxsize=1)
def get_embedder() -> EmbedderProtocol:
    """Return the process-wide embedder, honouring ``LATTICE_EMBEDDER`` env."""
    choice = os.environ.get("LATTICE_EMBEDDER", "").strip().lower()
    if choice == "hash":
        return HashEmbedder()
    return SentenceTransformerEmbedder(settings.embedding_model)


def reset_embedder_cache() -> None:
    """Clear the cached embedder (primarily useful in tests)."""
    get_embedder.cache_clear()


__all__ = [
    "EmbedderProtocol",
    "SentenceTransformerEmbedder",
    "HashEmbedder",
    "get_embedder",
    "reset_embedder_cache",
]
