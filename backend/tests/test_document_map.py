"""Tests for document map construction."""

from __future__ import annotations

from app.services.chunker import ChunkData
from app.services.document_map import build_document_map


def _chunk(
    ordinal: int,
    *,
    page_start: int,
    page_end: int,
    section: str | None,
) -> ChunkData:
    return ChunkData(
        ordinal=ordinal,
        text=f"chunk-{ordinal}",
        page_start=page_start,
        page_end=page_end,
        char_start=ordinal * 100,
        char_end=ordinal * 100 + 50,
        section_title=section,
    )


def test_build_document_map_groups_consecutive_sections() -> None:
    chunks = [
        _chunk(0, page_start=1, page_end=1, section="Intro"),
        _chunk(1, page_start=1, page_end=2, section="Intro"),
        _chunk(2, page_start=2, page_end=3, section="Design"),
        _chunk(3, page_start=3, page_end=4, section="Design"),
        _chunk(4, page_start=4, page_end=5, section="Conclusion"),
    ]
    result = build_document_map(chunks)
    assert result["num_chunks"] == 5
    assert result["num_pages"] == 5
    sections = result["sections"]
    assert len(sections) == 3

    intro = sections[0]
    assert intro["title"] == "Intro"
    assert intro["chunk_ordinal_start"] == 0
    assert intro["chunk_ordinal_end"] == 1
    assert intro["page_start"] == 1
    assert intro["page_end"] == 2
    assert intro["chunk_count"] == 2

    design = sections[1]
    assert design["title"] == "Design"
    assert design["chunk_count"] == 2

    conclusion = sections[2]
    assert conclusion["title"] == "Conclusion"
    assert conclusion["chunk_ordinal_start"] == 4
    assert conclusion["chunk_ordinal_end"] == 4


def test_build_document_map_handles_none_titles() -> None:
    chunks = [
        _chunk(0, page_start=1, page_end=1, section=None),
        _chunk(1, page_start=1, page_end=1, section=None),
        _chunk(2, page_start=2, page_end=2, section="Body"),
    ]
    result = build_document_map(chunks)
    sections = result["sections"]
    assert len(sections) == 2
    assert sections[0]["title"] is None
    assert sections[0]["chunk_count"] == 2
    assert sections[1]["title"] == "Body"


def test_build_document_map_empty() -> None:
    result = build_document_map([])
    assert result == {"sections": [], "num_chunks": 0, "num_pages": 0}
