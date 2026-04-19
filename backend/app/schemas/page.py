"""Schemas for page payloads."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class PageOut(BaseModel):
    """Lightweight page projection with a short text preview."""

    model_config = ConfigDict(from_attributes=True)

    page_number: int
    char_count: int
    preview: str


class PageFull(BaseModel):
    """Full page text payload."""

    model_config = ConfigDict(from_attributes=True)

    page_number: int
    char_count: int
    text: str


__all__ = ["PageOut", "PageFull"]
