# Shared helpers for the tools in this folder. Source it from a tool; do not run it.
# It loads tools.env, then fills the defaults that depend on other values.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools.env
. "$TOOLS_DIR/tools.env"

if [ -z "$APP_DIR" ]; then
  APP_DIR="$(cd "$TOOLS_DIR/../.." && pwd)"   # the tools live in <app>/scripts/tools, even inside a monorepo
fi
[ -n "$RUNS_DIR" ] || RUNS_DIR="$APP_DIR/runs"
[ -n "$DEV_CMD" ] || DEV_CMD="$PM_EXEC next dev -p $DEV_PORT -H $DEV_HOST"
if [ -z "$HEAVY_LOCK" ]; then
  HEAVY_LOCK="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/$(basename "$APP_DIR")-heavy.lock"
fi

# Free memory in MB: MemAvailable on Linux, free + inactive pages on macOS.
mem_free_mb() {
  if [ -r /proc/meminfo ]; then
    awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo
  elif command -v vm_stat >/dev/null 2>&1; then
    vm_stat | awk '/page size of/ {ps = $8} /Pages free/ {f = $3} /Pages inactive/ {i = $3}
      END {gsub(/\./, "", f); gsub(/\./, "", i); print int((f + i) * ps / 1048576)}'
  else
    echo 999999
  fi
}

# Waits until at least $1 MB are free, checking every 15 seconds, at most $2 rounds.
wait_for_memory() {
  local need=$1 rounds=${2:-$MEM_WAIT_ROUNDS} n=0
  while [ "$(mem_free_mb)" -lt "$need" ] && [ "$n" -lt "$rounds" ]; do
    sleep 15
    n=$((n + 1))
  done
}

# PID of the process listening on TCP port $1; prints nothing when the port is free.
# Without ss and lsof nothing can tell, and "free" would be a guess: it says so on stderr and returns 3.
port_pid() {
  if command -v ss >/dev/null 2>&1; then
    ss -lptnH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1
  else
    echo "port_pid: neither ss nor lsof is installed, so port $1 cannot be checked" >&2
    return 3
  fi
}

# Runs "$@" while holding the heavy-check lock, so only one heavy check runs on the machine at a time.
# Without flock (stock macOS) it warns and runs unqueued: a lock that can go stale is worse than none.
with_heavy_lock() {
  if command -v flock >/dev/null 2>&1; then
    mkdir -p "$(dirname "$HEAVY_LOCK")"
    (
      flock 9
      "$@"
    ) 9>"$HEAVY_LOCK"
  else
    echo "warning: flock not found, running without the queue" >&2
    "$@"
  fi
}
