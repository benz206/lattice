"""Schemas for document payloads."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.page import PageOut


class DocumentOut(BaseModel):
    """Summary projection of a document."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    content_type: str
    size_bytes: int
    num_pages: int | None
    status: str
    created_at: datetime
    updated_at: datetime
    error: str | None


class DocumentDetail(DocumentOut):
    """Document summary plus page previews."""

    pages: list[PageOut]


class DocumentStatus(BaseModel):
    """Lightweight status projection for polling."""

    id: str
    status: str
    num_pages: int | None
    error: str | None


__all__ = ["DocumentOut", "DocumentDetail", "DocumentStatus"]
