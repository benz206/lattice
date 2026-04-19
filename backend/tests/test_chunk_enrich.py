"""Tests for chunk summary + keyword helpers."""

from __future__ import annotations

from app.services.chunk_enrich import extract_keywords, summarize_chunk


def test_summarize_chunk_returns_leading_sentences() -> None:
    text = (
        "Retrieval quality depends on chunking. Overlap preserves context. "
        "The rest of the text can be ignored for a short summary."
    )
    summary = summarize_chunk(text, max_chars=80)
    assert summary.startswith("Retrieval quality depends on chunking.")
    assert len(summary) <= 80


def test_summarize_chunk_respects_max_chars() -> None:
    text = "A" * 500
    summary = summarize_chunk(text, max_chars=100)
    assert len(summary) <= 100


def test_summarize_chunk_handles_empty() -> None:
    assert summarize_chunk("") == ""
    assert summarize_chunk("   \n  ") == ""


def test_extract_keywords_excludes_stopwords_and_lowercases() -> None:
    text = (
        "The Lattice system retrieves evidence. Lattice processes documents "
        "and the documents contain evidence for lattice retrieval."
    )
    keywords = extract_keywords(text, top_k=5)
    assert keywords
    assert all(k == k.lower() for k in keywords)
    assert "the" not in keywords
    assert "and" not in keywords
    assert "lattice" in keywords


def test_extract_keywords_returns_top_k() -> None:
    text = " ".join(["alpha"] * 5 + ["beta"] * 4 + ["gamma"] * 3 + ["delta"] * 2)
    result = extract_keywords(text, top_k=2)
    assert result == ["alpha", "beta"]


def test_extract_keywords_tie_break_alphabetical() -> None:
    text = "zeta zeta apple apple"
    result = extract_keywords(text, top_k=2)
    assert result == ["apple", "zeta"]


def test_extract_keywords_empty_input() -> None:
    assert extract_keywords("") == []
    assert extract_keywords("the and for", top_k=3) == []
