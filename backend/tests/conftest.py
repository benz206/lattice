"""Shared test fixtures. Forces an ephemeral sqlite database for the test suite."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

# Redirect on-disk state to a temporary directory BEFORE importing the app so
# that settings and the SQLAlchemy engine are constructed against the test paths.
_TMPDIR = tempfile.mkdtemp(prefix="lattice-test-")
os.environ["DATA_DIR"] = _TMPDIR
os.environ["UPLOAD_DIR"] = str(Path(_TMPDIR) / "uploads")
os.environ["VECTOR_STORE_DIR"] = str(Path(_TMPDIR) / "vectorstore")
os.environ["SQLITE_PATH"] = str(Path(_TMPDIR) / "test.db")


@pytest.fixture(scope="session")
def app() -> Iterator["object"]:
    """Return the FastAPI app instance for tests."""
    from app.main import app as fastapi_app

    yield fastapi_app
