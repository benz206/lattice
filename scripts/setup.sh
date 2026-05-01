#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Setting up Lattice ==="
cd "$REPO_ROOT/frontend"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install it from https://bun.sh and re-run this script."
  exit 1
fi

echo "Installing dependencies with bun..."
bun install

echo ""
echo "Setup complete. Run 'bash scripts/dev.sh' to start Lattice."
