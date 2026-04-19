"""Application settings loaded from environment / .env file."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the Lattice backend."""

    model_config = SettingsConfigDict(
        env_file="../.env",
        extra="ignore",
        case_sensitive=False,
    )

    backend_port: int = 8000
    frontend_port: int = 3000
    frontend_origin: str = "http://localhost:3000"

    data_dir: str = "./backend/data"
    upload_dir: str = "./backend/data/uploads"
    sqlite_path: str = "./backend/data/app.db"
    vector_store_dir: str = "./backend/data/vectorstore"

    embedding_model: str = "Alibaba-NLP/gte-Qwen2-1.5B-instruct"
    embedding_model_fallback: str = "BAAI/bge-m3"

    llm_model: str = "Qwen/Qwen2.5-1.5B-Instruct"
    llm_backend: str = "transformers"
    inference_device: str = "auto"

    max_upload_mb: int = 200

    def ensure_dirs(self) -> None:
        """Create on-disk directories required for storage."""
        for path in (self.data_dir, self.upload_dir, self.vector_store_dir):
            Path(path).mkdir(parents=True, exist_ok=True)
        sqlite_parent = Path(self.sqlite_path).parent
        if str(sqlite_parent):
            sqlite_parent.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings singleton."""
    return Settings()


settings: Settings = get_settings()

__all__ = ["Settings", "settings", "get_settings"]
