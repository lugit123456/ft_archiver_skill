#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"

if [[ -x .venv/bin/python ]]; then
  exec .venv/bin/python sync_ft.py "$@"
fi

exec python3 sync_ft.py "$@"
