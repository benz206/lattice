"""Tests for the deterministic StubLlm and ``get_llm`` env override."""

from __future__ import annotations

import pytest

from app.adapters.llm import (
    Message,
    StubLlm,
    get_llm,
    reset_llm_cache,
)


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
