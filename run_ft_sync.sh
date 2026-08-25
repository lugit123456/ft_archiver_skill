#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
cd "$SCRIPT_DIR"

if [[ -x .venv/bin/python ]]; then
  PYTHON_BIN=.venv/bin/python
else
  PYTHON_BIN=python3
fi

SYNC_MAX_ATTEMPTS=${SYNC_MAX_ATTEMPTS:-2}
SYNC_RETRY_DELAY_S=${SYNC_RETRY_DELAY_S:-90}
for arg in "$@"; do
  case "$arg" in
    --login|--dry-run|--help|-h)
      SYNC_MAX_ATTEMPTS=1
      ;;
  esac
done

attempt=1
while true; do
  if "$PYTHON_BIN" sync_ft.py "$@"; then
    break
  fi
  status=$?
  if (( attempt >= SYNC_MAX_ATTEMPTS )); then
    exit "$status"
  fi
  print -u2 "FT 同步失败，${SYNC_RETRY_DELAY_S}s 后重试 (${attempt}/${SYNC_MAX_ATTEMPTS})"
  sleep "$SYNC_RETRY_DELAY_S"
  (( attempt++ ))
done

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

PUBLISH_LOCK_DIR=${PUBLISH_LOCK_DIR:-/tmp/paper-archive-publish.lock}
while ! mkdir "$PUBLISH_LOCK_DIR" 2>/dev/null; do
  print -u2 "等待其他报刊发布任务完成..."
  sleep 10
done
trap 'rmdir "$PUBLISH_LOCK_DIR" 2>/dev/null || true' EXIT

PUBLISH_MAX_ATTEMPTS=${PUBLISH_MAX_ATTEMPTS:-2}
PUBLISH_RETRY_DELAY_S=${PUBLISH_RETRY_DELAY_S:-60}
publish_attempt=1
while true; do
  if (
    cd "$PUBLISHER_DIR"
    "$PUBLISH_PYTHON" scripts/publish.py --no-process \
      --wsj-output-dir "$WSJ_OUTPUT_DIR" \
      --ft-output-dir "$FT_OUTPUT_DIR" \
      --te-output-dir "$TE_OUTPUT_DIR"
  ); then
    break
  fi
  status=$?
  if (( publish_attempt >= PUBLISH_MAX_ATTEMPTS )); then
    exit "$status"
  fi
  print -u2 "报刊线上发布失败，${PUBLISH_RETRY_DELAY_S}s 后重试 (${publish_attempt}/${PUBLISH_MAX_ATTEMPTS})"
  sleep "$PUBLISH_RETRY_DELAY_S"
  (( publish_attempt++ ))
done
