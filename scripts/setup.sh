#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Setting up backend ==="
cd "$REPO_ROOT/backend"

if [ ! -d ".venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
fi

echo "Activating venv and installing backend deps..."
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"

echo "=== Setting up frontend ==="
cd "$REPO_ROOT/frontend"

if command -v bun >/dev/null 2>&1; then
  echo "Installing Node dependencies with bun..."
  bun install
else
  echo "bun not found; falling back to npm..."
  npm install
fi

echo ""
echo "Setup complete. Run 'bash scripts/dev.sh' to start both services."
