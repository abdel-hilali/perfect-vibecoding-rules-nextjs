#!/usr/bin/env bash
# Lints the FILES given with --max-warnings=0, one heavy check at a time on this machine.
# Files only, never a folder: a builder lints what it changed, and a folder run competes with the other builders.
# Relative paths are read from APP_DIR. It waits for VITEST_MIN_FREE_MB of free memory: a typed lint loads the
# TypeScript program too.
# usage: q-eslint.sh <file> [<file> ...]   (TAIL_LINES=N shows more or fewer lines)
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  echo "usage: q-eslint.sh <file> [<file> ...]   (files only, paths relative to APP_DIR)" >&2
  exit 2
}
[ $# -gt 0 ] || usage
for f in "$@"; do
  case "$f" in -*) echo "refused: '$f' is an option; pass files only" >&2; usage ;; esac
  case "$f" in /*) p=$f ;; *) p=$APP_DIR/$f ;; esac
  if [ -d "$p" ]; then
    echo "refused: '$f' is a folder; pass the files you changed" >&2
    exit 2
  fi
  if [ ! -f "$p" ]; then
    echo "refused: '$f' not found (relative paths start at APP_DIR: $APP_DIR)" >&2
    exit 2
  fi
done

run_eslint() {
  local free
  free=$(mem_free_mb)
  if [ "$free" -lt "$VITEST_MIN_FREE_MB" ]; then
    echo "q-eslint: $free MB free, waiting for $VITEST_MIN_FREE_MB MB (at most $MEM_WAIT_ROUNDS rounds of 15 s)"
    wait_for_memory "$VITEST_MIN_FREE_MB"
  fi
  cd "$APP_DIR" || return 2
  # $PM_EXEC is split on purpose: "pnpm exec" is two words.
  $PM_EXEC eslint --max-warnings=0 "$@" 2>&1 | tail -n "${TAIL_LINES:-60}"
  return "${PIPESTATUS[0]}"
}

echo "q-eslint: queued (one heavy check at a time; a wait of minutes is normal while builders run)"
with_heavy_lock run_eslint "$@"
code=$?
echo "eslint exit: $code"
exit "$code"
