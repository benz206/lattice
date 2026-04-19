"""Shared test fixtures. Forces an ephemeral sqlite database for the test suite."""

from __future__ import annotations

import os
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest

# Redirect on-disk state to a temporary directory BEFORE importing the app so
# that settings and the SQLAlchemy engine are constructed against the test paths.
_TMPDIR = tempfile.mkdtemp(prefix="lattice-test-")
os.environ["DATA_DIR"] = _TMPDIR
os.environ["UPLOAD_DIR"] = str(Path(_TMPDIR) / "uploads")
os.environ["VECTOR_STORE_DIR"] = str(Path(_TMPDIR) / "vectorstore")
os.environ["SQLITE_PATH"] = str(Path(_TMPDIR) / "test.db")
# Force the deterministic hash-based embedder so tests do not download models.
os.environ["LATTICE_EMBEDDER"] = "hash"


@pytest.fixture(scope="session")
def app() -> Iterator["object"]:
    """Return the FastAPI app instance for tests."""
    import asyncio

    from app.core.config import settings
    from app.db.session import init_db
    from app.main import app as fastapi_app

    settings.ensure_dirs()
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(init_db())
    finally:
        loop.close()

    yield fastapi_app


def _build_sample_pdf(path: Path, page_texts: list[str]) -> None:
    import fitz

    doc = fitz.open()
    for text in page_texts:
        page = doc.new_page()
        page.insert_text((72, 96), text, fontsize=12)
    doc.save(str(path))
    doc.close()


@pytest.fixture(scope="session")
def sample_pdf_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Generate a deterministic 3-page sample PDF for tests."""
    path = tmp_path_factory.mktemp("fixtures") / "sample.pdf"
    _build_sample_pdf(
        path,
        [
            "Lattice sample page one. Evidence retrieval test content.",
            "Lattice sample page two. Additional content for page two.",
            "Lattice sample page three. Final page of the sample document.",
        ],
    )
    return path


@pytest.fixture
async def reset_db() -> AsyncIterator[None]:
    """Truncate document/page/chunk tables between tests and reset vector/lexical state."""
    from sqlalchemy import delete

    from app.db.session import async_session_maker
    from app.models.chunk import Chunk
    from app.models.document import Document
    from app.models.page import Page
    from app.services.lexical_index import get_lexical_index, reset_lexical_index
    from app.services.vector_store import get_vector_store

    async with async_session_maker() as session:
        await session.execute(delete(Chunk))
        await session.execute(delete(Page))
        await session.execute(delete(Document))
        await session.commit()

    # Clear the vector store collection so state does not leak across tests.
    try:
        vs = get_vector_store()
        existing = vs._collection.get(include=[]).get("ids") or []  # noqa: SLF001
        if existing:
            vs._collection.delete(ids=existing)  # noqa: SLF001
    except Exception:  # noqa: BLE001
        pass

    # Invalidate (and drop) the cached BM25 index.
    try:
        await get_lexical_index().invalidate()
    except Exception:  # noqa: BLE001
        pass
    reset_lexical_index()

    yield

    async with async_session_maker() as session:
        await session.execute(delete(Chunk))
        await session.execute(delete(Page))
        await session.execute(delete(Document))
        await session.commit()

    try:
        vs = get_vector_store()
        existing = vs._collection.get(include=[]).get("ids") or []  # noqa: SLF001
        if existing:
            vs._collection.delete(ids=existing)  # noqa: SLF001
    except Exception:  # noqa: BLE001
        pass
    try:
        await get_lexical_index().invalidate()
    except Exception:  # noqa: BLE001
        pass
    reset_lexical_index()
