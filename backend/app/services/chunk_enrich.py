"""Lightweight extractive summaries and TF-based keywords (no LLM, no external NLP)."""

from __future__ import annotations

import re

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])")
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9'\-]*")

_STOPWORDS: frozenset[str] = frozenset(
    {
        "the", "and", "for", "that", "with", "this", "are", "was", "but",
        "not", "you", "your", "all", "any", "can", "had", "has", "have",
        "from", "they", "their", "them", "there", "these", "those", "then",
        "than", "which", "who", "whom", "what", "when", "where", "why",
        "how", "will", "would", "could", "should", "may", "might", "must",
        "been", "being", "were", "into", "onto", "out", "off", "over",
        "under", "again", "further", "about", "above", "below", "because",
        "before", "after", "between", "during", "through", "while", "same",
        "some", "such", "each", "every", "few", "more", "most", "other",
        "own", "only", "very", "also", "just", "also", "thus", "upon",
    }
)


def summarize_chunk(text: str, max_chars: int = 200) -> str:
    """Return a short extractive summary: the first 1-2 sentences up to ``max_chars``."""
    if not text:
        return ""
    normalized = text.strip()
    if not normalized:
        return ""
    sentences = _SENTENCE_SPLIT.split(normalized)
    if not sentences:
        return normalized[:max_chars].strip()

    summary = ""
    taken = 0
    for sent in sentences[:2]:
        s = sent.strip()
        if not s:
            continue
        candidate = s if not summary else summary + " " + s
        if len(candidate) > max_chars and summary:
            break
        summary = candidate
        taken += 1
        if len(summary) >= max_chars:
            break

    if not summary:
        summary = sentences[0].strip()

    if len(summary) > max_chars:
        summary = summary[:max_chars].rstrip()
    return summary


def extract_keywords(text: str, top_k: int = 8) -> list[str]:
    """Return up to ``top_k`` frequency-ranked keywords (alphabetical tie-break)."""
    if not text or top_k <= 0:
        return []

    counts: dict[str, int] = {}
    for match in _WORD_RE.finditer(text):
        token = match.group(0).lower()
        if len(token) < 3:
            continue
        if token in _STOPWORDS:
            continue
        if not any(c.isalnum() for c in token):
            continue
        counts[token] = counts.get(token, 0) + 1

    if not counts:
        return []

    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [token for token, _ in ranked[:top_k]]


__all__ = ["summarize_chunk", "extract_keywords"]
