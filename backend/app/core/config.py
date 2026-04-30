"""Application settings loaded from environment / .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


def _resolve_repo_path(path_str: str) -> str:
    path = Path(path_str)
    if path.is_absolute():
        return str(path)
    return str((REPO_ROOT / path).resolve())


class Settings(BaseSettings):
    """Runtime configuration for the Lattice backend."""

    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
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
    embedder_backend: str = Field(default="", validation_alias="LATTICE_EMBEDDER")
    embed_batch_size: int = Field(default=16, validation_alias="LATTICE_EMBED_BATCH_SIZE")
    embedding_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        validation_alias="LATTICE_EMBEDDING_BASE_URL",
    )
    embedding_api_key: str = Field(default="", validation_alias="LATTICE_EMBEDDING_API_KEY")

    llm_model: str = "Qwen/Qwen2.5-1.5B-Instruct"
    llm_backend: str = "transformers"
    inference_device: str = "auto"
    llm_base_url: str = Field(
        default="http://localhost:11434/v1",
        validation_alias="LATTICE_LLM_BASE_URL",
    )
    llm_api_key: str = Field(default="", validation_alias="LATTICE_LLM_API_KEY")
    llm_http_referer: str = Field(
        default="",
        validation_alias="LATTICE_LLM_HTTP_REFERER",
    )
    llm_app_title: str = Field(
        default="Lattice",
        validation_alias="LATTICE_LLM_APP_TITLE",
    )
    llm_gguf_path: str = Field(default="", validation_alias="LATTICE_LLM_GGUF_PATH")
    llm_n_ctx: int = Field(default=4096, validation_alias="LATTICE_LLM_N_CTX")

    max_upload_mb: int = 200

    def model_post_init(self, __context: object) -> None:
        del __context
        self.data_dir = _resolve_repo_path(self.data_dir)
        self.upload_dir = _resolve_repo_path(self.upload_dir)
        self.sqlite_path = _resolve_repo_path(self.sqlite_path)
        self.vector_store_dir = _resolve_repo_path(self.vector_store_dir)

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
