#!/usr/bin/env bash
# Runs vitest on the test FILES given, one heavy check at a time on this machine, with two workers.
# It refuses anything that is not a test file: a folder or an empty argument list would run a whole suite,
# which takes minutes and the memory every other builder needs. Relative paths are read from APP_DIR.
# usage: q-vitest.sh <test file> [<test file> ...]   (TAIL_LINES=N shows more or fewer lines)
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  echo "usage: q-vitest.sh <test file> [<test file> ...]   (files named *.test.* or *.spec.*, never a folder)" >&2
  exit 2
}
[ $# -gt 0 ] || usage
for f in "$@"; do
  case "$f" in
    -*) echo "refused: '$f' is an option; pass test files only" >&2; usage ;;
    *.test.ts | *.test.tsx | *.test.js | *.test.jsx | *.test.mts | *.test.cts | *.test.mjs | *.test.cjs) ;;
    *.spec.ts | *.spec.tsx | *.spec.js | *.spec.jsx | *.spec.mts | *.spec.cts | *.spec.mjs | *.spec.cjs) ;;
    *) echo "refused: '$f' is not a test FILE (*.test.* or *.spec.*)" >&2; exit 2 ;;
  esac
  case "$f" in /*) p=$f ;; *) p=$APP_DIR/$f ;; esac
  if [ ! -f "$p" ]; then
    echo "refused: '$f' is not a file here (relative paths start at APP_DIR: $APP_DIR)" >&2
    exit 2
  fi
done

run_vitest() {
  local free
  free=$(mem_free_mb)
  if [ "$free" -lt "$VITEST_MIN_FREE_MB" ]; then
    echo "q-vitest: $free MB free, waiting for $VITEST_MIN_FREE_MB MB (at most $MEM_WAIT_ROUNDS rounds of 15 s)"
    wait_for_memory "$VITEST_MIN_FREE_MB"
  fi
  cd "$APP_DIR" || return 2
  # $PM_EXEC is split on purpose: "pnpm exec" is two words.
  $PM_EXEC vitest run "$@" --maxWorkers=2 2>&1 | tail -n "${TAIL_LINES:-80}"
  return "${PIPESTATUS[0]}"
}

echo "q-vitest: queued (one heavy check at a time; a wait of minutes is normal while builders run)"
with_heavy_lock run_vitest "$@"
code=$?
echo "vitest exit: $code"
exit "$code"
