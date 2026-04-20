"""FastAPI application entrypoint for the Lattice backend."""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.session import init_db

logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Application lifecycle: ensure storage and database are ready on startup."""
    settings.ensure_dirs()
    await init_db()

    embedder_override = os.environ.get("LATTICE_EMBEDDER", "").strip().lower()
    llm_override = os.environ.get("LATTICE_LLM", "").strip().lower()
    resolved_embedder = "hash" if embedder_override == "hash" else settings.embedding_model
    resolved_llm = "stub" if llm_override == "stub" else settings.llm_model
    logger.info(
        "lattice ready backend_port=%d embedder=%s llm=%s llm_backend=%s data_dir=%s",
        settings.backend_port,
        resolved_embedder,
        resolved_llm,
        settings.llm_backend,
        settings.data_dir,
    )
    yield


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    configure_logging()
    app = FastAPI(title="Lattice", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api")

    @app.get("/")
    async def root() -> dict[str, str]:
        return {"name": "lattice", "status": "ok"}

    return app


app = create_app()

__all__ = ["app", "create_app"]
