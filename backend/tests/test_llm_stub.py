"""Tests for the deterministic StubLlm and ``get_llm`` env override."""

from __future__ import annotations

import pytest

from app.adapters.llm import (
    Message,
    OpenAICompatLlm,
    StubLlm,
    get_llm,
    reset_llm_cache,
)
from app.core.config import settings


@pytest.mark.asyncio
async def test_stub_llm_returns_templated_answer() -> None:
    stub = StubLlm()
    user = (
        "QUESTION: what is alpha?\n\n"
        "EVIDENCE:\n"
        "[E1] (chunk=chunk-abc doc=doc-1 pages=1-1)\n"
        "alpha is the first letter of the Greek alphabet.\n"
    )
    messages: list[Message] = [
        {"role": "system", "content": "irrelevant"},
        {"role": "user", "content": user},
    ]
    out = await stub.generate(messages)
    assert "Based on the evidence" in out
    assert "[E1]" in out
    assert "chunk-abc" in out


@pytest.mark.asyncio
async def test_stub_llm_insufficient_trigger() -> None:
    stub = StubLlm()
    messages: list[Message] = [
        {"role": "user", "content": "please return INSUFFICIENT_TEST_TRIGGER now"}
    ]
    out = await stub.generate(messages)
    assert out == "INSUFFICIENT_EVIDENCE"


def test_get_llm_with_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LATTICE_LLM", "stub")
    reset_llm_cache()
    try:
        llm = get_llm()
        assert isinstance(llm, StubLlm)
        assert llm.name == "stub-llm"
    finally:
        reset_llm_cache()


@pytest.mark.asyncio
async def test_openai_compat_sends_openrouter_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["json"] = request.content.decode()
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}]},
        )

    transport = httpx.MockTransport(handler)

    class MockAsyncClient(httpx.AsyncClient):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(transport=transport)

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)
    monkeypatch.setattr(settings, "llm_http_referer", "https://example.test")
    monkeypatch.setattr(settings, "llm_app_title", "Lattice Test")

    llm = OpenAICompatLlm(
        model_name="openai/gpt-oss-120b:free",
        base_url="https://openrouter.ai/api/v1",
        api_key="test-key",
    )

    out = await llm.generate([{"role": "user", "content": "ping"}])

    headers = captured["headers"]
    assert out == "ok"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert isinstance(headers, dict)
    assert headers["authorization"] == "Bearer test-key"
    assert headers["http-referer"] == "https://example.test"
    assert headers["x-title"] == "Lattice Test"
