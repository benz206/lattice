"""Thin wrapper around a ChromaDB PersistentClient for chunk embeddings."""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)

_DEFAULT_COLLECTION = "lattice_chunks"


def _collection_name_for_current_embedder() -> str:
    """Return a stable collection name for the configured embedding model."""
    backend = (
        os.environ.get("LATTICE_EMBEDDER") or settings.embedder_backend
    ).strip().lower()
    model = settings.embedding_model.strip()
    if not backend and model == "Alibaba-NLP/gte-Qwen2-1.5B-instruct":
        return _DEFAULT_COLLECTION
    key = f"{backend or 'sentence_transformers'}:{model}"
    suffix = hashlib.blake2b(key.encode("utf-8"), digest_size=6).hexdigest()
    return f"{_DEFAULT_COLLECTION}_{suffix}"


@dataclass(frozen=True)
class VectorHit:
    """One result returned by ``VectorStore.query``."""

    chunk_id: str
    score: float
    metadata: dict[str, Any]
    text: str


def _sanitize_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    """Chroma disallows ``None`` values in metadata; coerce them to empty string."""
    return {k: ("" if v is None else v) for k, v in meta.items()}


class VectorStore:
    """Persistent ChromaDB-backed store of chunk embeddings."""

    def __init__(
        self,
        persist_path: str,
        collection_name: str = _DEFAULT_COLLECTION,
    ) -> None:
        # Local import so importing the module is cheap.
        import chromadb
        from chromadb.config import Settings as ChromaSettings

        Path(persist_path).mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=persist_path,
            settings=ChromaSettings(anonymized_telemetry=False, allow_reset=True),
        )
        self._collection = self._client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        self._collection_name = collection_name
        self._persist_path = persist_path

    @property
    def collection_name(self) -> str:
        return self._collection_name

    def upsert(
        self,
        chunk_ids: list[str],
        embeddings: np.ndarray,
        metadatas: list[dict[str, Any]],
        documents: list[str],
    ) -> None:
        """Bulk upsert. Expects ``len(chunk_ids) == embeddings.shape[0]``."""
        if len(chunk_ids) == 0:
            return
        if embeddings.shape[0] != len(chunk_ids):
            raise ValueError(
                f"embeddings row count {embeddings.shape[0]} "
                f"!= chunk_ids length {len(chunk_ids)}"
            )
        if len(metadatas) != len(chunk_ids) or len(documents) != len(chunk_ids):
            raise ValueError("metadatas/documents length must equal chunk_ids length")

        cleaned = [_sanitize_metadata(m) for m in metadatas]
        self._collection.upsert(
            ids=list(chunk_ids),
            embeddings=embeddings.astype(np.float32).tolist(),
            metadatas=cleaned,
            documents=list(documents),
        )

    def query(
        self,
        embedding: np.ndarray,
        *,
        top_k: int = 20,
        where: dict[str, Any] | None = None,
    ) -> list[VectorHit]:
        """Query the store with a single embedding; returns at most ``top_k`` hits."""
        if embedding.ndim == 1:
            vector = embedding.reshape(1, -1)
        else:
            vector = embedding

        kwargs: dict[str, Any] = {
            "query_embeddings": vector.astype(np.float32).tolist(),
            "n_results": max(1, int(top_k)),
            "include": ["metadatas", "documents", "distances"],
        }
        if where:
            kwargs["where"] = where

        raw = self._collection.query(**kwargs)

        ids_batch = raw.get("ids") or [[]]
        distances_batch = raw.get("distances") or [[]]
        metadatas_batch = raw.get("metadatas") or [[]]
        documents_batch = raw.get("documents") or [[]]

        ids = ids_batch[0] if ids_batch else []
        distances = distances_batch[0] if distances_batch else []
        metadatas = metadatas_batch[0] if metadatas_batch else []
        documents = documents_batch[0] if documents_batch else []

        hits: list[VectorHit] = []
        for i, chunk_id in enumerate(ids):
            distance = float(distances[i]) if i < len(distances) else 1.0
            # Cosine distance in [0, 2] — convert to a similarity in [-1, 1].
            similarity = 1.0 - distance
            metadata = dict(metadatas[i]) if i < len(metadatas) and metadatas[i] else {}
            text = documents[i] if i < len(documents) else ""
            hits.append(
                VectorHit(
                    chunk_id=str(chunk_id),
                    score=similarity,
                    metadata=metadata,
                    text=text or "",
                )
            )
        return hits

    def delete_document(self, document_id: str) -> None:
        """Delete all vectors that belong to ``document_id``."""
        try:
            self._collection.delete(where={"document_id": document_id})
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "vector_store delete_document failed document_id=%s error=%s",
                document_id,
                exc,
            )

    def delete_chunks(self, chunk_ids: list[str]) -> None:
        """Delete the specified chunk ids (best-effort)."""
        if not chunk_ids:
            return
        try:
            self._collection.delete(ids=list(chunk_ids))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "vector_store delete_chunks failed count=%d error=%s",
                len(chunk_ids),
                exc,
            )

    def get(self, chunk_ids: list[str]) -> list[VectorHit]:
        """Fetch stored vectors/text/metadata for the given chunk ids."""
        if not chunk_ids:
            return []
        raw = self._collection.get(
            ids=list(chunk_ids),
            include=["metadatas", "documents"],
        )
        ids = raw.get("ids") or []
        metadatas = raw.get("metadatas") or []
        documents = raw.get("documents") or []
        hits: list[VectorHit] = []
        for i, chunk_id in enumerate(ids):
            metadata = dict(metadatas[i]) if i < len(metadatas) and metadatas[i] else {}
            text = documents[i] if i < len(documents) else ""
            hits.append(
                VectorHit(
                    chunk_id=str(chunk_id),
                    score=1.0,
                    metadata=metadata,
                    text=text or "",
                )
            )
        return hits

    def count(self) -> int:
        """Return the number of vectors currently stored."""
        try:
            return int(self._collection.count())
        except Exception:  # noqa: BLE001
            return 0


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStore:
    """Return a cached ``VectorStore`` pointed at ``settings.vector_store_dir``."""
    return VectorStore(
        persist_path=settings.vector_store_dir,
        collection_name=_collection_name_for_current_embedder(),
    )


def reset_vector_store_cache() -> None:
    """Clear the cached vector store (primarily useful in tests)."""
    get_vector_store.cache_clear()


__all__ = [
    "VectorHit",
    "VectorStore",
    "get_vector_store",
    "reset_vector_store_cache",
]
