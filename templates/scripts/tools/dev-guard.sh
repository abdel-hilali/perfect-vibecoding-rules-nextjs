#!/usr/bin/env bash
# Stops the dev server when free memory falls under GUARD_MIN_FREE_MB, so the machine never runs
# out of memory and freezes. dev-keeper.sh starts the server again once memory is back.
# It stops only a server whose working directory is inside APP_DIR: another project's server
# on the same port is left alone. Run it detached, beside the keeper:
#   setsid nohup scripts/tools/dev-guard.sh >/dev/null 2>&1 </dev/null &
#   (macOS has no setsid: nohup scripts/tools/dev-guard.sh >/dev/null 2>&1 </dev/null & disown)
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  echo "usage: dev-guard.sh [--once | --stop]" >&2
  exit 2
}

MODE=loop
case "${1:-}" in
  "") ;;
  --once) MODE=once ;;
  --stop) MODE=stop ;;
  *) usage ;;
esac
[ $# -le 1 ] || usage

STATE_DIR="$RUNS_DIR/dev"
LOG="$STATE_DIR/guard.log"
PIDFILE="$STATE_DIR/guard.pid"
mkdir -p "$STATE_DIR"
APP_REAL=$(cd "$APP_DIR" 2>/dev/null && pwd -P) || APP_REAL="$APP_DIR"

log() {
  local line
  line="$(date '+%F %T') guard: $*"
  echo "$line"
  echo "$line" >>"$LOG"
}

# Working directory of a process: /proc on Linux, lsof on macOS.
pid_cwd() {
  if [ -e "/proc/$1/cwd" ]; then
    readlink "/proc/$1/cwd" 2>/dev/null
  elif command -v lsof >/dev/null 2>&1; then
    lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
  fi
}

in_app() {
  case "$1/" in "$APP_REAL"/*) return 0 ;; esac
  return 1
}

running_pid() {
  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null) || return 0
  case "$pid" in '' | *[!0-9]*) return 0 ;; esac
  [ "$pid" != "$$" ] || return 0
  if ps -o args= -p "$pid" 2>/dev/null | grep -q 'dev-guard\.sh'; then
    echo "$pid"
  fi
}

# Returns 0 when it stopped the server, so the loop can pause and let memory settle.
check_once() {
  local free pid cwd
  free=$(mem_free_mb)
  if [ "$free" -ge "$GUARD_MIN_FREE_MB" ]; then
    [ "$MODE" = once ] && log "$free MB free (floor $GUARD_MIN_FREE_MB): nothing to do"
    return 1
  fi
  if ! pid=$(port_pid "$DEV_PORT" 2>/dev/null); then
    [ "$MODE" = once ] && log "$free MB free, but port $DEV_PORT cannot be checked (install ss or lsof): nothing done"
    return 1
  fi
  if [ -z "$pid" ]; then
    [ "$MODE" = once ] && log "$free MB free, but port $DEV_PORT is already down"
    return 1
  fi
  cwd=$(pid_cwd "$pid")
  if ! in_app "$cwd"; then
    log "$free MB free; port $DEV_PORT belongs to pid $pid in ${cwd:-an unknown folder}, outside the app: left alone"
    return 1
  fi
  kill "$pid" 2>/dev/null && log "$free MB free (floor $GUARD_MIN_FREE_MB): stopped the dev server on port $DEV_PORT (pid $pid)"
  return 0
}

case "$MODE" in
  stop)
    pid=$(running_pid)
    if [ -z "$pid" ]; then
      echo "guard not running"
      exit 0
    fi
    kill "$pid" && log "stopped guard pid $pid"
    exit 0
    ;;
  once)
    check_once
    exit 0
    ;;
esac

other=$(running_pid)
if [ -n "$other" ]; then
  echo "guard already running (pid $other); stop it with: dev-guard.sh --stop" >&2
  exit 1
fi
echo "$$" >"$PIDFILE"
SLEEP_PID=""
trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; rm -f "$PIDFILE"; exit 0' TERM INT
log "guard started (pid $$): stops port $DEV_PORT under $GUARD_MIN_FREE_MB MB free"
while true; do
  pause=3
  # After a stop, wait longer: memory takes a moment to come back.
  check_once && pause=20
  sleep "$pause" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
done
