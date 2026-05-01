#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting Lattice on port ${FRONTEND_PORT:-3000}..."
cd "$REPO_ROOT/frontend"
bun run dev --port "${FRONTEND_PORT:-3000}"
