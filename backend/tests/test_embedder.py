"""Tests for the embedder adapters."""

from __future__ import annotations

import numpy as np
import pytest

from app.adapters.embedder import (
    EmbedderProtocol,
    HashEmbedder,
    OpenAICompatEmbedder,
    get_embedder,
    reset_embedder_cache,
)
from app.core.config import settings


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


def test_openai_compat_embedder_posts_embeddings_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    import httpx

    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["json"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "object": "list",
                "data": [
                    {"object": "embedding", "embedding": [3.0, 4.0], "index": 0},
                    {"object": "embedding", "embedding": [0.0, 2.0], "index": 1},
                ],
            },
        )

    transport = httpx.MockTransport(handler)

    class MockClient(httpx.Client):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(transport=transport)

    monkeypatch.setattr(httpx, "Client", MockClient)
    monkeypatch.setattr(settings, "llm_http_referer", "https://example.test")
    monkeypatch.setattr(settings, "llm_app_title", "Lattice Test")

    embedder = OpenAICompatEmbedder(
        model_name="nvidia/llama-nemotron-embed-vl-1b-v2:free",
        base_url="https://openrouter.ai/api/v1",
        api_key="test-key",
    )

    out = embedder.embed(["alpha", "bravo"], kind="passage")

    headers = captured["headers"]
    payload = captured["json"]
    assert out.shape == (2, 2)
    assert out.dtype == np.float32
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-5)
    assert captured["url"] == "https://openrouter.ai/api/v1/embeddings"
    assert isinstance(headers, dict)
    assert headers["authorization"] == "Bearer test-key"
    assert headers["http-referer"] == "https://example.test"
    assert headers["x-title"] == "Lattice Test"
    assert payload == {
        "model": "nvidia/llama-nemotron-embed-vl-1b-v2:free",
        "input": ["alpha", "bravo"],
    }


def test_get_embedder_returns_openai_compat_when_env_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LATTICE_EMBEDDER", "openrouter")
    reset_embedder_cache()
    try:
        embedder = get_embedder()
        assert isinstance(embedder, OpenAICompatEmbedder)
    finally:
        reset_embedder_cache()
