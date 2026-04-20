#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

trap 'echo "Shutting down..."; kill 0' EXIT

echo "Starting backend on port ${BACKEND_PORT:-8000}..."
(
  cd "$REPO_ROOT/backend"
  source .venv/bin/activate
  uvicorn app.main:app --reload --port "${BACKEND_PORT:-8000}"
) &

echo "Starting frontend on port ${FRONTEND_PORT:-3000}..."
(
  cd "$REPO_ROOT/frontend"
  if command -v bun >/dev/null 2>&1; then
    bun run dev --port "${FRONTEND_PORT:-3000}"
  else
    npm run dev -- --port "${FRONTEND_PORT:-3000}"
  fi
) &

wait
