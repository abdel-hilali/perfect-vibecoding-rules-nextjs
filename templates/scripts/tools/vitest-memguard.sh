#!/usr/bin/env bash
# Stops the vitest run that uses the most memory when free memory falls under MEMGUARD_MIN_FREE_MB.
# Parallel test runs can fill the memory and freeze the machine; losing one run is cheaper.
# Only runs whose working directory is inside APP_DIR count: another project's tests are left alone.
# Processes are listed with "ps -eo" and matched here in code. "pgrep -f vitest" would also match
# this script's own command line.
# Run it detached while builders or test runs are active:
#   setsid nohup scripts/tools/vitest-memguard.sh >/dev/null 2>&1 </dev/null &
#   (macOS has no setsid: nohup scripts/tools/vitest-memguard.sh >/dev/null 2>&1 </dev/null & disown)
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  echo "usage: vitest-memguard.sh [--once | --stop | --list]" >&2
  exit 2
}

MODE=loop
case "${1:-}" in
  "") ;;
  --once) MODE=once ;;
  --stop) MODE=stop ;;
  --list) MODE=list ;;
  *) usage ;;
esac
[ $# -le 1 ] || usage

STATE_DIR="$RUNS_DIR/dev"
LOG="$STATE_DIR/memguard.log"
PIDFILE="$STATE_DIR/memguard.pid"
mkdir -p "$STATE_DIR"
APP_REAL=$(cd "$APP_DIR" 2>/dev/null && pwd -P) || APP_REAL="$APP_DIR"

log() {
  local line
  line="$(date '+%F %T') memguard: $*"
  echo "$line"
  echo "$line" >>"$LOG"
}

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
  if ps -o args= -p "$pid" 2>/dev/null | grep -q 'vitest-memguard\.sh'; then
    echo "$pid"
  fi
}

# Prints "<tree RSS in KB> <pid>" for every vitest run on the machine. A run is a process with an
# argument named vitest.mjs (what every package manager ends up starting) or a command named vitest.
# Its tree adds the memory of all its descendants (the worker processes).
vitest_runs() {
  ps -eo pid=,ppid=,rss=,args= | awk -v self="$$" '
    {
      pid = $1; parent[pid] = $2; rss[pid] = $3; order[++n] = pid
      hit = 0
      for (i = 4; i <= NF; i++) { a = $i; sub(/.*\//, "", a); if (a == "vitest.mjs") hit = 1 }
      b = $4; sub(/.*\//, "", b); if (b == "vitest") hit = 1
      if (hit && pid != self) run[pid] = 1
    }
    END {
      for (k = 1; k <= n; k++) {
        p = order[k]; q = p
        for (d = 0; d < 64 && (q in parent); d++) {
          if (q in run) { tree[q] += rss[p]; break }
          q = parent[q]
        }
      }
      for (r in run) print tree[r] + 0, r
    }'
}

# The biggest run inside the app, as "<tree KB> <pid>"; empty when there is none.
biggest_run() {
  local kb pid best_kb=-1 best_pid=""
  while read -r kb pid; do
    [ -n "$pid" ] || continue
    in_app "$(pid_cwd "$pid")" || continue
    if [ "$kb" -gt "$best_kb" ]; then
      best_kb=$kb
      best_pid=$pid
    fi
  done <<EOF
$(vitest_runs)
EOF
  [ -n "$best_pid" ] && echo "$best_kb $best_pid"
  return 0
}

# Returns 0 when it stopped a run, so the loop can pause and let memory settle.
check_once() {
  local free victim kb pid
  free=$(mem_free_mb)
  if [ "$free" -ge "$MEMGUARD_MIN_FREE_MB" ]; then
    [ "$MODE" = once ] && log "$free MB free (floor $MEMGUARD_MIN_FREE_MB): nothing to do"
    return 1
  fi
  victim=$(biggest_run)
  if [ -z "$victim" ]; then
    [ "$MODE" = once ] && log "$free MB free, but no vitest run of this app is active"
    return 1
  fi
  kb=${victim% *}
  pid=${victim#* }
  kill "$pid" 2>/dev/null && log "$free MB free (floor $MEMGUARD_MIN_FREE_MB): stopped vitest pid $pid (its tree used $((kb / 1024)) MB)"
  return 0
}

case "$MODE" in
  list)
    vitest_runs | while read -r kb pid; do
      [ -n "$pid" ] || continue
      cwd=$(pid_cwd "$pid")
      if in_app "$cwd"; then where=app; else where=other; fi
      echo "pid $pid  $((kb / 1024)) MB  $where  ${cwd:-?}"
    done
    exit 0
    ;;
  stop)
    pid=$(running_pid)
    if [ -z "$pid" ]; then
      echo "memguard not running"
      exit 0
    fi
    kill "$pid" && log "stopped memguard pid $pid"
    exit 0
    ;;
  once)
    check_once
    exit 0
    ;;
esac

other=$(running_pid)
if [ -n "$other" ]; then
  echo "memguard already running (pid $other); stop it with: vitest-memguard.sh --stop" >&2
  exit 1
fi
echo "$$" >"$PIDFILE"
SLEEP_PID=""
trap '[ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null; rm -f "$PIDFILE"; exit 0' TERM INT
log "memguard started (pid $$): stops the biggest vitest run under $MEMGUARD_MIN_FREE_MB MB free"
while true; do
  pause=5
  check_once && pause=10
  sleep "$pause" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
done
