"""PDF text extraction via PyMuPDF."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import fitz


class PdfParseError(Exception):
    """Raised when a PDF cannot be opened or parsed."""


@dataclass(frozen=True)
class PageText:
    """Text content for a single PDF page."""

    page_number: int
    text: str
    char_count: int


_MULTI_BLANKLINE = re.compile(r"\n{3,}")
_TRAILING_SPACES = re.compile(r"[ \t]+(?=\n)")


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _TRAILING_SPACES.sub("", text)
    text = _MULTI_BLANKLINE.sub("\n\n", text)
    return text.strip("\n")


def extract_pages(path: str) -> list[PageText]:
    """Extract per-page text from the PDF at ``path`` (1-indexed page numbers)."""
    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001
        raise PdfParseError(f"Failed to open PDF: {exc}") from exc

    pages: list[PageText] = []
    try:
        for index, page in enumerate(doc, start=1):
            try:
                raw = page.get_text("text")
            except Exception as exc:  # noqa: BLE001
                raise PdfParseError(f"Failed to extract page {index}: {exc}") from exc
            text = _normalize(raw or "")
            pages.append(PageText(page_number=index, text=text, char_count=len(text)))
    finally:
        doc.close()
    return pages


def extract_metadata(path: str) -> dict[str, Any]:
    """Extract best-effort metadata from the PDF."""
    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001
        raise PdfParseError(f"Failed to open PDF: {exc}") from exc
    try:
        meta = dict(doc.metadata or {})
        result: dict[str, Any] = {"num_pages": doc.page_count}
        for src, dst in (
            ("title", "title"),
            ("author", "author"),
            ("producer", "producer"),
            ("creationDate", "creation_date"),
        ):
            value = meta.get(src)
            if value:
                result[dst] = value
        return result
    finally:
        doc.close()


__all__ = ["PageText", "PdfParseError", "extract_pages", "extract_metadata"]
