"""Document outline builder — groups consecutive chunks by section."""

from __future__ import annotations

from typing import Any

from app.services.chunker import ChunkData


def build_document_map(chunks: list[ChunkData]) -> dict[str, Any]:
    """Group consecutive chunks sharing ``section_title`` into an outline."""
    sections: list[dict[str, Any]] = []

    for chunk in chunks:
        if sections and sections[-1]["title"] == chunk.section_title:
            current = sections[-1]
            current["chunk_ordinal_end"] = chunk.ordinal
            current["page_end"] = max(current["page_end"], chunk.page_end)
            current["page_start"] = min(current["page_start"], chunk.page_start)
            current["chunk_count"] += 1
        else:
            sections.append(
                {
                    "title": chunk.section_title,
                    "chunk_ordinal_start": chunk.ordinal,
                    "chunk_ordinal_end": chunk.ordinal,
                    "page_start": chunk.page_start,
                    "page_end": chunk.page_end,
                    "chunk_count": 1,
                }
            )

    num_pages = max((c.page_end for c in chunks), default=0)

    return {
        "sections": sections,
        "num_chunks": len(chunks),
        "num_pages": num_pages,
    }


__all__ = ["build_document_map"]
