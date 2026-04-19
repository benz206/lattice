"""Tests for the embedder adapters."""

from __future__ import annotations

import numpy as np
import pytest

from app.adapters.embedder import (
    EmbedderProtocol,
    HashEmbedder,
    get_embedder,
    reset_embedder_cache,
)


def test_hash_embedder_basic_properties() -> None:
    embedder = HashEmbedder(dim=256)
    assert embedder.dim == 256
    assert embedder.name == "hash-test-embedder"


def test_hash_embedder_empty_input_returns_empty_matrix() -> None:
    embedder = HashEmbedder(dim=256)
    out = embedder.embed([])
    assert out.shape == (0, 256)


def test_hash_embedder_returns_normalized_float32() -> None:
    embedder = HashEmbedder(dim=256)
    out = embedder.embed(["hello world"])
    assert out.shape == (1, 256)
    assert out.dtype == np.float32
    norms = np.linalg.norm(out, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-5)


def test_hash_embedder_is_deterministic() -> None:
    embedder = HashEmbedder(dim=256)
    a = embedder.embed(["alpha beta gamma"])
    b = embedder.embed(["alpha beta gamma"])
    assert np.array_equal(a, b)


def test_hash_embedder_different_texts_differ() -> None:
    embedder = HashEmbedder(dim=256)
    out = embedder.embed(["alpha beta gamma", "completely different content"])
    assert out.shape == (2, 256)
    assert not np.array_equal(out[0], out[1])


def test_hash_embedder_invalid_dim_raises() -> None:
    with pytest.raises(ValueError):
        HashEmbedder(dim=0)
    with pytest.raises(ValueError):
        HashEmbedder(dim=300)


def test_hash_embedder_satisfies_protocol() -> None:
    assert isinstance(HashEmbedder(), EmbedderProtocol)


def test_get_embedder_returns_hash_embedder_when_env_set() -> None:
    # ``conftest.py`` sets LATTICE_EMBEDDER=hash before app import.
    reset_embedder_cache()
    try:
        embedder = get_embedder()
        assert isinstance(embedder, HashEmbedder)
    finally:
        reset_embedder_cache()
