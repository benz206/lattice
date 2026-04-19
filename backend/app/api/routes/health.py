"""Health check endpoint."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health() -> dict[str, str]:
    """Return a static liveness payload."""
    return {"status": "ok", "version": "0.1.0"}


__all__ = ["router"]
