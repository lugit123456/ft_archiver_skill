#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"

if [[ -x .venv/bin/python ]]; then
  PYTHON_BIN=.venv/bin/python
else
  PYTHON_BIN=python3
fi

"$PYTHON_BIN" sync_ft.py "$@"

AUTO_PUBLISH_AFTER_SYNC=${AUTO_PUBLISH_AFTER_SYNC:-1}
if [[ "$AUTO_PUBLISH_AFTER_SYNC" == "0" || "$AUTO_PUBLISH_AFTER_SYNC" == "false" || "$AUTO_PUBLISH_AFTER_SYNC" == "False" ]]; then
  exit 0
fi

for arg in "$@"; do
  case "$arg" in
    --login|--dry-run|--help|-h)
      exit 0
      ;;
  esac
done

PUBLISHER_DIR=${PAPER_PUBLISHER_DIR:-"$SCRIPT_DIR/../auto-paper-md-converter-skill"}
if [[ ! -d "$PUBLISHER_DIR" ]]; then
  print -u2 "跳过线上发布：未找到发布项目 $PUBLISHER_DIR"
  exit 0
fi

if [[ -x "$PUBLISHER_DIR/.venv/bin/python" ]]; then
  PUBLISH_PYTHON="$PUBLISHER_DIR/.venv/bin/python"
else
  PUBLISH_PYTHON=python3
fi

WSJ_OUTPUT_DIR=${WSJ_ARCHIVER_OUTPUT_DIR:-"$SCRIPT_DIR/../wsj_archiver_skill/output_results"}
FT_OUTPUT_DIR=${FT_ARCHIVER_OUTPUT_DIR:-"$SCRIPT_DIR/output_results"}
TE_OUTPUT_DIR=${ECONOMIST_OUTPUT_DIR:-"$SCRIPT_DIR/../economist_weekly_archiver_skill/output_results"}

(
  cd "$PUBLISHER_DIR"
  "$PUBLISH_PYTHON" scripts/publish.py --no-process \
    --wsj-output-dir "$WSJ_OUTPUT_DIR" \
    --ft-output-dir "$FT_OUTPUT_DIR" \
    --te-output-dir "$TE_OUTPUT_DIR"
)
