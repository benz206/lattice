"""ORM models. Importing this package registers all tables on Base.metadata."""

from __future__ import annotations

from app.models.chunk import Chunk
from app.models.document import Document
from app.models.page import Page

__all__ = ["Document", "Page", "Chunk"]
