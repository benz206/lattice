"""API route modules."""

from __future__ import annotations

from app.api.routes.documents import router as documents_router
from app.api.routes.health import router as health_router

__all__ = ["health_router", "documents_router"]
