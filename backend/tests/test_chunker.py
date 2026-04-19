"""Tests for the section-aware chunker."""

from __future__ import annotations

from app.services.chunker import ChunkData, chunk_document, concat_pages
from app.services.pdf_parser import PageText


def _make_pages() -> list[PageText]:
    para_a = (
        "Lattice is an evidence-retrieval system designed for dense documents. "
        "It ingests PDFs, splits them into sections, and chunks sections into "
        "retrievable units. Each chunk preserves its page span and character "
        "offsets so downstream retrieval can surface precise citations. "
        "The chunker aims to keep semantic coherence within a chunk while "
        "matching a target character length so embeddings remain meaningful."
    )
    para_b = (
        "Determinism is critical: given the same input, the chunker must "
        "produce the same output. This matters for testing, reproducibility, "
        "and debugging retrieval pipelines end to end. The implementation "
        "therefore avoids any randomness and relies on greedy packing."
    )
    para_c = (
        "The design tracks section headings through simple heuristics. "
        "Markdown-style headings, numbered headings, and short all-caps "
        "lines are treated as boundaries. Sections then become the unit of "
        "overlap scope; overlap never crosses section boundaries."
    )
    para_d = (
        "Integration with the ingestion pipeline stores each chunk in the "
        "database alongside a summary and extracted keywords. A document "
        "map groups consecutive chunks by section for navigation. "
        "All of this happens synchronously inside the background task."
    )

    page_one = "# Introduction\n\n" + para_a + "\n\n" + para_b
    page_two = "# Design\n\n" + para_c
    page_three = "# Integration\n\n" + para_d

    return [
        PageText(page_number=1, text=page_one, char_count=len(page_one)),
        PageText(page_number=2, text=page_two, char_count=len(page_two)),
        PageText(page_number=3, text=page_three, char_count=len(page_three)),
    ]


def test_concat_pages_offsets_are_correct() -> None:
    pages = _make_pages()
    full, offsets = concat_pages(pages)
    assert len(offsets) == 3
    assert offsets[0] == 0
    for page, offset in zip(pages, offsets):
        assert full[offset : offset + len(page.text)] == page.text


def test_chunk_document_basic_invariants() -> None:
    pages = _make_pages()
    full_text, _ = concat_pages(pages)
    chunks = chunk_document(pages, target_chars=400, overlap_chars=80, min_chunk_chars=50)

    assert chunks, "expected at least one chunk"
    for i, chunk in enumerate(chunks):
        assert chunk.ordinal == i
        assert chunk.page_start <= chunk.page_end
        assert 1 <= chunk.page_start <= len(pages)
        assert 1 <= chunk.page_end <= len(pages)
        assert chunk.char_start >= 0
        assert chunk.char_end > chunk.char_start
        core = chunk.text[chunk.overlap_prefix_len :]
        assert full_text[chunk.char_start : chunk.char_end] == core

    for prev, nxt in zip(chunks, chunks[1:]):
        assert prev.char_start <= nxt.char_start


def test_chunk_document_preserves_section_titles() -> None:
    pages = _make_pages()
    chunks = chunk_document(pages, target_chars=400, overlap_chars=80)
    titles = {chunk.section_title for chunk in chunks}
    assert "Introduction" in titles
    assert "Design" in titles
    assert "Integration" in titles

    section_of = {
        "Introduction": [c for c in chunks if c.section_title == "Introduction"],
        "Design": [c for c in chunks if c.section_title == "Design"],
        "Integration": [c for c in chunks if c.section_title == "Integration"],
    }
    for group in section_of.values():
        assert group, "each section should contain at least one chunk"


def test_chunk_document_is_deterministic() -> None:
    pages = _make_pages()
    a = chunk_document(pages, target_chars=400, overlap_chars=80)
    b = chunk_document(pages, target_chars=400, overlap_chars=80)
    assert [
        (c.ordinal, c.text, c.char_start, c.char_end, c.section_title, c.overlap_prefix_len)
        for c in a
    ] == [
        (c.ordinal, c.text, c.char_start, c.char_end, c.section_title, c.overlap_prefix_len)
        for c in b
    ]


def test_chunk_document_handles_empty_pages() -> None:
    chunks = chunk_document([])
    assert chunks == []
    empty = [PageText(page_number=1, text="   ", char_count=3)]
    assert chunk_document(empty) == []


def test_chunk_dataclass_defaults() -> None:
    c = ChunkData(
        ordinal=0,
        text="hello",
        page_start=1,
        page_end=1,
        char_start=0,
        char_end=5,
    )
    assert c.section_title is None
    assert c.overlap_prefix_len == 0
