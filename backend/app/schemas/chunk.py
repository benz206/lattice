"""Schemas for chunk payloads."""

from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict, field_validator


class ChunkOut(BaseModel):
    """Public projection of a Chunk row."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    ordinal: int
    text: str
    page_start: int
    page_end: int
    char_start: int
    char_end: int
    section_title: str | None
    summary: str | None
    keywords: list[str]

    @field_validator("keywords", mode="before")
    @classmethod
    def _parse_keywords(cls, value: object) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, list):
            return [str(item) for item in value]
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except ValueError:
                return []
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
            return []
        return []


__all__ = ["ChunkOut"]
