"""Tests for the PDF parser service."""

from __future__ import annotations

from pathlib import Path

from app.services.pdf_parser import extract_metadata, extract_pages


def test_extract_pages_returns_three_pages(sample_pdf_path: Path) -> None:
    pages = extract_pages(str(sample_pdf_path))
    assert len(pages) == 3
    for i, page in enumerate(pages, start=1):
        assert page.page_number == i
        assert page.text.strip() != ""
        assert page.char_count == len(page.text)


def test_extract_pages_is_deterministic(sample_pdf_path: Path) -> None:
    a = extract_pages(str(sample_pdf_path))
    b = extract_pages(str(sample_pdf_path))
    assert [p.text for p in a] == [p.text for p in b]


def test_extract_metadata_reports_num_pages(sample_pdf_path: Path) -> None:
    meta = extract_metadata(str(sample_pdf_path))
    assert meta.get("num_pages") == 3
