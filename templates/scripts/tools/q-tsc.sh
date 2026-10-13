#!/usr/bin/env bash
# Type-checks the whole project, one heavy check at a time on this machine.
# Parallel builders share one machine: two tsc runs at once can run it out of memory. So this waits for the
# shared lock, then for free memory, then runs, and prints only the tail of the output.
# usage: q-tsc.sh   (no arguments: tsc always checks the whole project; TAIL_LINES=N shows more or fewer lines)
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if [ $# -gt 0 ]; then
  echo "usage: q-tsc.sh   (no arguments: it checks the whole project)" >&2
  exit 2
fi
if [ ! -d "$APP_DIR" ]; then
  echo "q-tsc: APP_DIR '$APP_DIR' is not a folder (set it in scripts/tools/tools.env)" >&2
  exit 2
fi

run_tsc() {
  local free
  free=$(mem_free_mb)
  if [ "$free" -lt "$TSC_MIN_FREE_MB" ]; then
    echo "q-tsc: $free MB free, waiting for $TSC_MIN_FREE_MB MB (at most $MEM_WAIT_ROUNDS rounds of 15 s)"
    wait_for_memory "$TSC_MIN_FREE_MB"
  fi
  cd "$APP_DIR" || return 2
  # $PM_EXEC is split on purpose: "pnpm exec" is two words.
  $PM_EXEC tsc --noEmit 2>&1 | tail -n "${TAIL_LINES:-60}"
  return "${PIPESTATUS[0]}"
}

echo "q-tsc: queued (one heavy check at a time; a wait of minutes is normal while builders run)"
with_heavy_lock run_tsc
code=$?
echo "tsc exit: $code"
exit "$code"
