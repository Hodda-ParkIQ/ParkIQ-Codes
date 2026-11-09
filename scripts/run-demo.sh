#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
(cd frontend && corepack pnpm@10.20.0 install --frozen-lockfile && corepack pnpm@10.20.0 build)
exec .venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
