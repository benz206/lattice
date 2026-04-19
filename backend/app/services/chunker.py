"""Section-aware, deterministic chunker for parsed PDF pages."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.pdf_parser import PageText

_PAGE_SEP = "\n\n"

_MARKDOWN_HEADING = re.compile(r"^#+\s+\S.*$")
_ALLCAPS_HEADING = re.compile(r"^[A-Z0-9][A-Z0-9 \-:,&/()']{1,79}$")
_NUMBERED_HEADING = re.compile(r"^\d+(?:\.\d+)*\s+[A-Z].*$")

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


@dataclass(frozen=True)
class ChunkData:
    """A contiguous slice of document text, plus metadata for retrieval."""

    ordinal: int
    text: str
    page_start: int
    page_end: int
    char_start: int
    char_end: int
    section_title: str | None = None
    overlap_prefix_len: int = 0


def concat_pages(pages: list[PageText]) -> tuple[str, list[int]]:
    """Concatenate page texts with a fixed separator; return (full_text, offsets).

    ``offsets[i]`` is the global character offset where ``pages[i].text`` begins.
    """
    parts: list[str] = []
    offsets: list[int] = []
    cursor = 0
    for i, page in enumerate(pages):
        offsets.append(cursor)
        parts.append(page.text)
        cursor += len(page.text)
        if i != len(pages) - 1:
            parts.append(_PAGE_SEP)
            cursor += len(_PAGE_SEP)
    return "".join(parts), offsets


def _is_heading(line: str, prev: str | None, nxt: str | None) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if _MARKDOWN_HEADING.match(stripped):
        return True
    if _NUMBERED_HEADING.match(stripped) and len(stripped) <= 120:
        return True
    if (
        2 <= len(stripped) <= 80
        and _ALLCAPS_HEADING.match(stripped)
        and any(c.isalpha() for c in stripped)
        and stripped.upper() == stripped
    ):
        return True
    if (
        (prev is None or prev.strip() == "")
        and (nxt is None or nxt.strip() == "")
        and len(stripped) < 90
        and stripped[0].isalpha()
        and stripped[0].isupper()
        and not stripped.endswith((".", "!", "?", ","))
    ):
        return True
    return False


def _clean_heading(line: str) -> str:
    stripped = line.strip()
    if stripped.startswith("#"):
        stripped = stripped.lstrip("#").strip()
    return stripped


def _detect_sections(full_text: str) -> list[tuple[int, int, str | None]]:
    """Return list of (start_offset, end_offset, title) for each section span."""
    lines = full_text.split("\n")
    # Compute line start offsets.
    line_starts: list[int] = []
    cursor = 0
    for line in lines:
        line_starts.append(cursor)
        cursor += len(line) + 1  # account for the '\n' separator

    heading_indices: list[int] = []
    for i, line in enumerate(lines):
        prev = lines[i - 1] if i > 0 else None
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        if _is_heading(line, prev, nxt):
            heading_indices.append(i)

    sections: list[tuple[int, int, str | None]] = []
    if not heading_indices or heading_indices[0] != 0:
        first_end = (
            line_starts[heading_indices[0]] if heading_indices else len(full_text)
        )
        sections.append((0, first_end, None))

    for idx, line_idx in enumerate(heading_indices):
        title = _clean_heading(lines[line_idx])
        body_start = line_starts[line_idx]
        if idx + 1 < len(heading_indices):
            body_end = line_starts[heading_indices[idx + 1]]
        else:
            body_end = len(full_text)
        sections.append((body_start, body_end, title))

    # Drop empty sections.
    return [s for s in sections if s[1] > s[0]]


def _split_paragraphs(section_text: str) -> list[tuple[int, str]]:
    """Return list of (offset_within_section, paragraph_text)."""
    paragraphs: list[tuple[int, str]] = []
    cursor = 0
    for raw in re.split(r"(\n\s*\n)", section_text):
        if not raw:
            continue
        if raw.strip() == "":
            cursor += len(raw)
            continue
        paragraphs.append((cursor, raw))
        cursor += len(raw)
    return paragraphs


def _split_sentences(paragraph: str) -> list[tuple[int, str]]:
    """Return list of (offset_within_paragraph, sentence_text)."""
    results: list[tuple[int, str]] = []
    cursor = 0
    parts = _SENTENCE_SPLIT.split(paragraph)
    for i, part in enumerate(parts):
        if not part:
            continue
        start = paragraph.find(part, cursor)
        if start < 0:
            start = cursor
        results.append((start, part))
        cursor = start + len(part)
        # Advance past whitespace separator consumed by the regex.
        if i + 1 < len(parts):
            while cursor < len(paragraph) and paragraph[cursor].isspace():
                cursor += 1
    return results


def _overlap_prefix(prev_text: str, overlap_chars: int) -> str:
    """Return overlap snippet from end of ``prev_text``, rounded to sentence boundary."""
    if overlap_chars <= 0 or not prev_text:
        return ""
    if len(prev_text) <= overlap_chars:
        return prev_text
    tail = prev_text[-overlap_chars:]
    # Try to start at the first sentence boundary inside the tail.
    match = _SENTENCE_SPLIT.search(tail)
    if match is not None:
        return tail[match.end() :]
    return tail


def _compute_pages(
    char_start: int, char_end: int, page_offsets: list[int], total_len: int
) -> tuple[int, int]:
    """Return 1-indexed (page_start, page_end) for a [char_start, char_end) span."""
    if not page_offsets:
        return 1, 1
    page_start = 1
    for i, offset in enumerate(page_offsets):
        if offset <= char_start:
            page_start = i + 1
        else:
            break
    page_end = page_start
    end_probe = max(char_end - 1, char_start)
    for i, offset in enumerate(page_offsets):
        if offset <= end_probe:
            page_end = i + 1
        else:
            break
    return page_start, page_end


def _pack_units(
    units: list[tuple[int, str]],
    target_chars: int,
) -> list[tuple[int, int]]:
    """Greedy pack (start, text) units into spans.

    Returns a list of (start_offset, end_offset) within the section. A single
    unit larger than ``target_chars`` becomes its own span.
    """
    spans: list[tuple[int, int]] = []
    if not units:
        return spans

    buf_start = units[0][0]
    buf_end = units[0][0] + len(units[0][1])
    buf_len = len(units[0][1])

    for start, text in units[1:]:
        length = len(text)
        end = start + length
        if buf_len == 0:
            buf_start = start
            buf_end = end
            buf_len = length
            continue
        # If adding this unit keeps us close to target, include it.
        if buf_len + (start - buf_end) + length <= target_chars:
            buf_end = end
            buf_len = buf_end - buf_start
        else:
            spans.append((buf_start, buf_end))
            buf_start = start
            buf_end = end
            buf_len = length

    spans.append((buf_start, buf_end))
    return spans


def _section_spans(
    section_text: str, target_chars: int
) -> list[tuple[int, int]]:
    """Return list of (start_offset, end_offset) within the section."""
    paragraphs = _split_paragraphs(section_text)
    if not paragraphs:
        return []

    units: list[tuple[int, str]] = []
    for p_offset, para in paragraphs:
        if len(para) <= target_chars:
            units.append((p_offset, para))
            continue
        sentences = _split_sentences(para)
        if not sentences:
            units.append((p_offset, para))
            continue
        for s_offset, sent in sentences:
            units.append((p_offset + s_offset, sent))

    return _pack_units(units, target_chars)


def chunk_document(
    pages: list[PageText],
    *,
    target_chars: int = 1200,
    overlap_chars: int = 200,
    min_chunk_chars: int = 200,
) -> list[ChunkData]:
    """Split ``pages`` into deterministic, section-aware chunks."""
    if not pages:
        return []

    full_text, page_offsets = concat_pages(pages)
    total_len = len(full_text)
    if not full_text.strip():
        return []

    sections = _detect_sections(full_text)
    chunks: list[ChunkData] = []
    ordinal = 0

    for section_start, section_end, title in sections:
        section_text = full_text[section_start:section_end]
        if not section_text.strip():
            continue
        spans = _section_spans(section_text, target_chars)
        if not spans:
            continue

        prev_core_text: str | None = None
        for local_start, local_end in spans:
            char_start = section_start + local_start
            char_end = section_start + local_end
            core = full_text[char_start:char_end]

            overlap = ""
            if prev_core_text is not None and overlap_chars > 0:
                overlap = _overlap_prefix(prev_core_text, overlap_chars)

            text = overlap + core
            page_start, page_end = _compute_pages(
                char_start, char_end, page_offsets, total_len
            )

            chunks.append(
                ChunkData(
                    ordinal=ordinal,
                    text=text,
                    page_start=page_start,
                    page_end=page_end,
                    char_start=char_start,
                    char_end=char_end,
                    section_title=title,
                    overlap_prefix_len=len(overlap),
                )
            )
            ordinal += 1
            prev_core_text = core

    # Merge undersized chunks into the previous chunk (unless it's the only one).
    merged: list[ChunkData] = []
    for chunk in chunks:
        core_len = chunk.char_end - chunk.char_start
        if core_len < min_chunk_chars and merged:
            prev = merged[-1]
            new_core = full_text[prev.char_start : chunk.char_end]
            merged[-1] = ChunkData(
                ordinal=prev.ordinal,
                text=prev.text[: prev.overlap_prefix_len] + new_core,
                page_start=prev.page_start,
                page_end=max(prev.page_end, chunk.page_end),
                char_start=prev.char_start,
                char_end=chunk.char_end,
                section_title=prev.section_title,
                overlap_prefix_len=prev.overlap_prefix_len,
            )
        else:
            merged.append(chunk)

    # Reassign ordinals after any merges.
    final: list[ChunkData] = []
    for i, chunk in enumerate(merged):
        if chunk.ordinal == i:
            final.append(chunk)
        else:
            final.append(
                ChunkData(
                    ordinal=i,
                    text=chunk.text,
                    page_start=chunk.page_start,
                    page_end=chunk.page_end,
                    char_start=chunk.char_start,
                    char_end=chunk.char_end,
                    section_title=chunk.section_title,
                    overlap_prefix_len=chunk.overlap_prefix_len,
                )
            )
    return final


__all__ = ["ChunkData", "chunk_document", "concat_pages"]
