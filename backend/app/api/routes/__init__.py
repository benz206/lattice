"""API route modules."""

from __future__ import annotations

from app.api.routes.documents import router as documents_router
from app.api.routes.health import router as health_router
from app.api.routes.search import router as search_router

__all__ = ["health_router", "documents_router", "search_router"]
