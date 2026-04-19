"""Top-level API router aggregating all sub-routers."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import documents_router, health_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(documents_router)

__all__ = ["api_router"]
