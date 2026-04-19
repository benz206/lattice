"""Pydantic schemas for request/response models."""

from __future__ import annotations

from app.schemas.document import DocumentDetail, DocumentOut, DocumentStatus
from app.schemas.page import PageFull, PageOut

__all__ = [
    "DocumentOut",
    "DocumentDetail",
    "DocumentStatus",
    "PageOut",
    "PageFull",
]
