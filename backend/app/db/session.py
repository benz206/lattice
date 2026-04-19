"""Async SQLAlchemy engine, session factory, and initialization helpers."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.db.base import Base


def _build_url() -> str:
    return f"sqlite+aiosqlite:///{settings.sqlite_path}"


engine = create_async_engine(_build_url(), future=True)
async_session_maker: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine, expire_on_commit=False
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an async SQLAlchemy session."""
    async with async_session_maker() as session:
        yield session


async def init_db() -> None:
    """Create all tables defined on the declarative metadata."""
    # Import models so their tables are registered on Base.metadata.
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


__all__ = [
    "engine",
    "async_session_maker",
    "get_session",
    "init_db",
]
