#!/usr/bin/env bash
# Keeps the dev server up. Every 10 seconds: when nothing listens on DEV_PORT and at least
# KEEPER_MIN_FREE_MB are free, it starts DEV_CMD in APP_DIR, detached. A start stamp blocks a second
# start inside KEEPER_COOLDOWN_S, because the server needs time to bind and a double start crashes both.
# Run it detached so it outlives the terminal and the agent session:
#   setsid nohup scripts/tools/dev-keeper.sh >/dev/null 2>&1 </dev/null &
#   (macOS has no setsid: nohup scripts/tools/dev-keeper.sh >/dev/null 2>&1 </dev/null & disown)
# A reboot stops it: start it again after one.
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  echo "usage: dev-keeper.sh [--once | --stop | --status]" >&2
  exit 2
}

MODE=loop
case "${1:-}" in
  "") ;;
  --once) MODE=once ;;
  --stop) MODE=stop ;;
  --status) MODE=status ;;
  *) usage ;;
esac
[ $# -le 1 ] || usage

STATE_DIR="$RUNS_DIR/dev"
LOG="$STATE_DIR/keeper.log"
SERVER_LOG="$STATE_DIR/dev-server.log"
STAMP="$STATE_DIR/keeper.last"
PIDFILE="$STATE_DIR/keeper.pid"
mkdir -p "$STATE_DIR"

log() {
  local line
  line="$(date '+%F %T') keeper: $*"
  echo "$line"
  echo "$line" >>"$LOG"
}

# PID of a keeper loop already running for this app. The PID file alone can be stale after a
# reboot, so the process must still exist and still be this script.
running_pid() {
  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null) || return 0
  case "$pid" in '' | *[!0-9]*) return 0 ;; esac
  [ "$pid" != "$$" ] || return 0
  if ps -o args= -p "$pid" 2>/dev/null | grep -q 'dev-keeper\.sh'; then
    echo "$pid"
  fi
}

start_server() {
  echo "$(date +%s)" >"$STAMP"
  log "port $DEV_PORT is down, $1 MB free: starting: $DEV_CMD"
  # setsid puts the server in its own session, so stopping the keeper or closing the
  # terminal does not take the site down. macOS has no setsid: nohup alone is the fallback.
  # The redirections wrap the whole subshell, so no copy of the keeper's output stays open.
  (
    cd "$APP_DIR" || exit 1
    if command -v setsid >/dev/null 2>&1; then
      exec setsid nohup sh -c "$DEV_CMD"
    fi
    exec nohup sh -c "$DEV_CMD"
  ) >>"$SERVER_LOG" 2>&1 </dev/null &
}

LAST_NOTE=""
# Logs a "not starting" reason only when it changes, so a long wait does not flood the log.
note() {
  [ "$1" = "$LAST_NOTE" ] && return 0
  LAST_NOTE="$1"
  log "$1"
}

check_once() {
  local pid
  # A port nobody can check is not a free port: starting a second server on it would crash both.
  pid=$(port_pid "$DEV_PORT" 2>/dev/null) || { note "cannot check port $DEV_PORT: install ss or lsof"; return 0; }
  if [ -n "$pid" ]; then
    LAST_NOTE=""
    [ "$MODE" = once ] && log "port $DEV_PORT is up"
    return 0
  fi
  local free last now
  free=$(mem_free_mb)
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  case "$last" in '' | *[!0-9]*) last=0 ;; esac
  now=$(date +%s)
  if [ $((now - last)) -lt "$KEEPER_COOLDOWN_S" ]; then
    note "port $DEV_PORT is down, last start $((now - last)) s ago: waiting for the ${KEEPER_COOLDOWN_S} s cooldown"
  elif [ "$free" -lt "$KEEPER_MIN_FREE_MB" ]; then
    note "port $DEV_PORT is down, only $free MB free (need $KEEPER_MIN_FREE_MB): waiting for memory"
  else
    LAST_NOTE=""
    start_server "$free"
  fi
}

case "$MODE" in
  status)
    pid=$(running_pid)
    if [ -n "$pid" ]; then echo "keeper running (pid $pid)"; else echo "keeper not running"; fi
    if ! srv=$(port_pid "$DEV_PORT" 2>/dev/null); then echo "port $DEV_PORT: cannot check (install ss or lsof)"
    elif [ -n "$srv" ]; then echo "port $DEV_PORT up (pid $srv)"; else echo "port $DEV_PORT down"; fi
    echo "free memory: $(mem_free_mb) MB"
    exit 0
    ;;
  stop)
    pid=$(running_pid)
    if [ -z "$pid" ]; then
      echo "keeper not running"
      exit 0
    fi
    kill "$pid" && log "stopped keeper pid $pid (the dev server keeps running; free-port.sh stops it)"
    exit 0
    ;;
  once)
    check_once
    exit 0
    ;;
esac

other=$(running_pid)
if [ -n "$other" ]; then
  echo "keeper already running (pid $other); stop it with: dev-keeper.sh --stop" >&2
  exit 1
fi
echo "$$" >"$PIDFILE"
SLEEP_PID=""
# The sleep runs in the background so a stop signal is handled at once, not after the nap.
trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; rm -f "$PIDFILE"; exit 0' TERM INT
log "keeper started (pid $$) for port $DEV_PORT in $APP_DIR"
while true; do
  check_once
  sleep 10 &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
done
