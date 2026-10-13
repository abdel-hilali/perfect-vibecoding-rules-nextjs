#!/usr/bin/env bash
# Frees a TCP port by stopping the one process that listens on it, found by PID, never by name.
# It prints the owner first: its PID, command and working directory. It stops the owner only when
# that directory is inside APP_DIR, or with --force. A name filter once stopped an editor's own
# helper process; reading the working directory first prevents that.
# Exit codes: 0 the port is free, 1 the port is still held or cannot be checked (no ss or lsof), 2 wrong arguments.
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  echo "usage: free-port.sh <port> [--force]" >&2
  exit 2
}

PORT=""
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*) usage ;;
    *)
      [ -z "$PORT" ] || usage
      PORT=$arg
      ;;
  esac
done
case "$PORT" in '' | *[!0-9]*) usage ;; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || usage

APP_REAL=$(cd "$APP_DIR" 2>/dev/null && pwd -P) || APP_REAL="$APP_DIR"

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

# Waits up to $1 seconds for the port to be released; returns 0 once it is.
wait_free() {
  local i=0
  while [ "$i" -lt $(($1 * 4)) ]; do
    [ -z "$(port_pid "$PORT")" ] && return 0
    sleep 0.25
    i=$((i + 1))
  done
  [ -z "$(port_pid "$PORT")" ]
}

PID=$(port_pid "$PORT") || exit 1
if [ -z "$PID" ]; then
  echo "port $PORT is free (or held by another user's process, which this script cannot see or stop)"
  exit 0
fi

ARGS=$(ps -o args= -p "$PID" 2>/dev/null)
CWD=$(pid_cwd "$PID")
echo "port $PORT: pid $PID"
echo "  command: ${ARGS:-?}"
echo "  cwd:     ${CWD:-?}"

if in_app "$CWD"; then
  echo "  inside the app ($APP_REAL): stopping it"
elif [ "$FORCE" -eq 1 ]; then
  echo "  outside the app, --force given: stopping it"
else
  echo "  outside the app ($APP_REAL): left alone. Check it is safe, then run: free-port.sh $PORT --force"
  exit 1
fi

kill "$PID" 2>/dev/null
if wait_free 10; then
  echo "port $PORT is free"
  exit 0
fi
if [ "$FORCE" -eq 1 ]; then
  # The owner ignored a polite stop for 10 seconds; --force allows the hard stop.
  kill -9 "$PID" 2>/dev/null
  if wait_free 5; then
    echo "port $PORT is free (stopped with KILL)"
    exit 0
  fi
fi
echo "port $PORT is still held by pid $(port_pid "$PORT")" >&2
exit 1
