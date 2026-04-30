"""LLM adapters for the answering pipeline.

Provides a small async ``LlmProtocol`` plus four implementations:

* ``StubLlm``        — deterministic, dependency-free; used in tests.
* ``TransformersLlm``— HuggingFace causal LM via ``transformers``; lazy import.
* ``OpenAICompatLlm``— async ``httpx`` client against an OpenAI-compatible API.
* ``LlamaCppLlm``    — wraps ``llama_cpp.Llama``; lazy import.

Heavy backends are imported lazily inside the class so ``import app.adapters.llm``
stays cheap and tests that use the stub never need transformers/llama_cpp.
"""

from __future__ import annotations

import asyncio
import os
import re
from functools import lru_cache
from typing import Any, Literal, Protocol, TypedDict, runtime_checkable

from app.core.config import settings


class Message(TypedDict):
    """One turn in a chat-style prompt."""

    role: Literal["system", "user", "assistant"]
    content: str


@runtime_checkable
class LlmProtocol(Protocol):
    """Async chat-completion protocol implemented by every backend."""

    @property
    def name(self) -> str: ...

    async def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        stop: list[str] | None = None,
    ) -> str: ...


_EVIDENCE_RE = re.compile(r"^\s*EVIDENCE\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
_FIRST_CHUNK_RE = re.compile(r"\[E(\d+)\]\s*\(chunk=([^)\s]+)")


class StubLlm:
    """Deterministic test backend.

    Looks at the last user message: extracts the first ``[E#]`` evidence line
    (which carries a ``chunk=<id>`` annotation in the prompt format used by the
    answering service) and emits a fixed templated answer that cites it. If the
    user message contains the literal token ``INSUFFICIENT_TEST_TRIGGER`` the
    backend returns the canonical insufficient marker.
    """

    INSUFFICIENT_TRIGGER = "INSUFFICIENT_TEST_TRIGGER"

    @property
    def name(self) -> str:
        return "stub-llm"

    async def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        stop: list[str] | None = None,
    ) -> str:
        del max_tokens, temperature, stop
        last_user = ""
        for msg in reversed(messages):
            if msg["role"] == "user":
                last_user = msg["content"]
                break
        if self.INSUFFICIENT_TRIGGER in last_user:
            return "INSUFFICIENT_EVIDENCE"

        # Extract first evidence snippet + chunk id from the prompt format used
        # by ``answering.build_prompt`` (which embeds ``chunk=<id>``).
        first_idx = "1"
        snippet = ""
        chunk_id = ""
        match = _FIRST_CHUNK_RE.search(last_user)
        if match:
            first_idx = match.group(1)
            chunk_id = match.group(2)
            # Pull the text following the closing ``)`` of that header.
            tail = last_user[match.end() :]
            # Skip the rest of the header up to ``)``.
            close = tail.find(")")
            if close != -1:
                tail = tail[close + 1 :]
            snippet = tail.strip().splitlines()[0].strip() if tail.strip() else ""
            snippet = snippet[:120]

        if not snippet:
            # Fallback: use any "EVIDENCE:" line if present.
            ev_match = _EVIDENCE_RE.search(last_user)
            if ev_match:
                snippet = ev_match.group(1).strip()[:120]

        if not snippet:
            snippet = last_user.strip()[:120]

        cite = f"[E{first_idx}]"
        if chunk_id:
            return f"Based on the evidence: {snippet}. {cite} [citation: {chunk_id}]"
        return f"Based on the evidence: {snippet}. {cite}"


class TransformersLlm:
    """HuggingFace ``transformers`` backend. Lazy-loaded."""

    def __init__(self, model_name: str | None = None, device: str | None = None) -> None:
        self._model_name = model_name or settings.llm_model
        self._device_pref = device or settings.inference_device
        self._tokenizer: Any = None
        self._model: Any = None

    @property
    def name(self) -> str:
        return self._model_name

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
            from transformers import (  # type: ignore[import-not-found]
                AutoModelForCausalLM,
                AutoTokenizer,
            )
        except ImportError as exc:
            raise RuntimeError(
                "transformers is not installed; install it or set LATTICE_LLM=stub."
            ) from exc
        device = self._select_device()
        tokenizer = AutoTokenizer.from_pretrained(self._model_name)
        model = AutoModelForCausalLM.from_pretrained(self._model_name)
        try:
            model = model.to(device)
        except Exception:  # noqa: BLE001
            pass
        self._tokenizer = tokenizer
        self._model = model

    def _generate_sync(
        self,
        messages: list[Message],
        *,
        max_tokens: int,
        temperature: float,
        stop: list[str] | None,
    ) -> str:
        self._ensure_loaded()
        tokenizer = self._tokenizer
        model = self._model

        if hasattr(tokenizer, "apply_chat_template"):
            prompt = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            parts: list[str] = []
            for msg in messages:
                parts.append(f"{msg['role'].upper()}: {msg['content']}")
            parts.append("ASSISTANT:")
            prompt = "\n".join(parts)

        inputs = tokenizer(prompt, return_tensors="pt")
        try:
            inputs = {k: v.to(model.device) for k, v in inputs.items()}
        except Exception:  # noqa: BLE001
            pass

        gen_kwargs: dict[str, Any] = {
            "max_new_tokens": int(max_tokens),
            "do_sample": temperature > 0.0,
        }
        if temperature > 0.0:
            gen_kwargs["temperature"] = float(temperature)
        eos_id = getattr(tokenizer, "eos_token_id", None)
        if eos_id is not None:
            gen_kwargs["pad_token_id"] = eos_id

        output = model.generate(**inputs, **gen_kwargs)
        prompt_len = inputs["input_ids"].shape[-1]
        new_tokens = output[0][prompt_len:]
        text = tokenizer.decode(new_tokens, skip_special_tokens=True)

        if stop:
            for marker in stop:
                idx = text.find(marker)
                if idx != -1:
                    text = text[:idx]
        return text.strip()

    async def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        stop: list[str] | None = None,
    ) -> str:
        return await asyncio.to_thread(
            self._generate_sync,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=stop,
        )


class OpenAICompatLlm:
    """Async client for any OpenAI-compatible ``/v1/chat/completions`` endpoint.

    Works with Ollama (``http://localhost:11434/v1``), OpenRouter, vLLM,
    llama.cpp's server, LM Studio, and the OpenAI API itself.
    """

    def __init__(
        self,
        model_name: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self._model_name = model_name or settings.llm_model
        self._base_url = (
            base_url
            or settings.llm_base_url
        ).rstrip("/")
        self._api_key = api_key if api_key is not None else settings.llm_api_key

    @property
    def name(self) -> str:
        return self._model_name

    async def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        stop: list[str] | None = None,
    ) -> str:
        import httpx

        payload: dict[str, Any] = {
            "model": self._model_name,
            "messages": list(messages),
            "temperature": float(temperature),
            "max_tokens": int(max_tokens),
        }
        if stop:
            payload["stop"] = list(stop)

        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        if settings.llm_http_referer:
            headers["HTTP-Referer"] = settings.llm_http_referer
        if settings.llm_app_title:
            headers["X-Title"] = settings.llm_app_title

        url = f"{self._base_url}/chat/completions"
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(
                f"OpenAI-compatible response missing choices[0].message.content: {data!r}"
            ) from exc
        return (content or "").strip()


class LlamaCppLlm:
    """``llama_cpp.Llama`` backend reading a GGUF path from env."""

    def __init__(self, model_path: str | None = None) -> None:
        self._model_path = model_path or settings.llm_gguf_path
        self._n_ctx = max(512, int(settings.llm_n_ctx))
        self._llama: Any = None

    @property
    def name(self) -> str:
        base = os.path.basename(self._model_path) if self._model_path else "llama-cpp"
        return base or "llama-cpp"

    def _ensure_loaded(self) -> None:
        if self._llama is not None:
            return
        if not self._model_path:
            raise RuntimeError(
                "LATTICE_LLM_GGUF_PATH is not set; cannot initialize LlamaCppLlm."
            )
        try:
            from llama_cpp import Llama  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError(
                "llama_cpp is not installed; install llama-cpp-python or set LATTICE_LLM=stub."
            ) from exc
        self._llama = Llama(
            model_path=self._model_path,
            n_ctx=self._n_ctx,
            verbose=False,
        )

    def _generate_sync(
        self,
        messages: list[Message],
        *,
        max_tokens: int,
        temperature: float,
        stop: list[str] | None,
    ) -> str:
        self._ensure_loaded()
        llama = self._llama
        kwargs: dict[str, Any] = {
            "messages": list(messages),
            "max_tokens": int(max_tokens),
            "temperature": float(temperature),
        }
        if stop:
            kwargs["stop"] = list(stop)
        result = llama.create_chat_completion(**kwargs)
        try:
            content = result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(
                f"llama_cpp returned unexpected payload: {result!r}"
            ) from exc
        return (content or "").strip()

    async def generate(
        self,
        messages: list[Message],
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        stop: list[str] | None = None,
    ) -> str:
        return await asyncio.to_thread(
            self._generate_sync,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=stop,
        )


@lru_cache(maxsize=1)
def get_llm() -> LlmProtocol:
    """Return the process-wide LLM, honouring ``LATTICE_LLM`` env override."""
    choice = os.environ.get("LATTICE_LLM", "").strip().lower()
    if choice == "stub":
        return StubLlm()

    backend = (settings.llm_backend or "transformers").strip().lower()
    if backend == "openai_compat":
        return OpenAICompatLlm()
    if backend == "llama_cpp":
        return LlamaCppLlm()
    if backend == "stub":
        return StubLlm()
    return TransformersLlm()


def reset_llm_cache() -> None:
    """Clear the cached LLM (primarily useful in tests)."""
    get_llm.cache_clear()


__all__ = [
    "Message",
    "LlmProtocol",
    "StubLlm",
    "TransformersLlm",
    "OpenAICompatLlm",
    "LlamaCppLlm",
    "get_llm",
    "reset_llm_cache",
]
