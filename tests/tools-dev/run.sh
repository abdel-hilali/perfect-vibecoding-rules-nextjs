#!/usr/bin/env bash
# Tests the dev tools: dev-keeper.sh, dev-guard.sh, vitest-memguard.sh and free-port.sh.
# Stubs: a fake dev server that listens on a free port, fake vitest runs that hold known memory,
# and a fake memory reading (the copied lib.sh reads free memory from a file).
# Works from any directory, writes only inside a mktemp folder, removes it at the end.
# Exits 0 only when every case passes.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
KIT=$(cd "$HERE/../.." && pwd)
SRC="$KIT/templates/scripts/tools"
TOOLS="dev-keeper.sh dev-guard.sh vitest-memguard.sh free-port.sh"

command -v node >/dev/null 2>&1 || { echo "tools-dev: node is required"; exit 1; }

T=$(mktemp -d)
export T

cleanup() {
  # Every process this test started runs node or bash on a file inside the temp folder.
  # The match is tight on purpose: a shell that only mentions the folder must survive.
  ps -eo pid=,args= | awk '$2 ~ /(^|\/)(node|bash|sh)$/ && index($3, ENVIRON["T"] "/") == 1 {print $1}' | while read -r p; do
    [ "$p" != "$$" ] && kill "$p" 2>/dev/null
  done
  for p in ${KILL_LATER:-}; do kill "$p" 2>/dev/null; done
  sleep 0.3
  rm -rf "$T"
}
trap cleanup EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/     | /'; }
# check <name> <command...>: passes when the command succeeds.
check() {
  local name=$1
  shift
  if "$@"; then ok "$name"; else bad "$name" "${OUT:-}"; fi
}

# --- sandbox ----------------------------------------------------------------------------------
mkdir -p "$T/tools" "$T/app/node_modules/vitest" "$T/other/node_modules/vitest" "$T/runs"
cp "$SRC/lib.sh" "$SRC/tools.env" "$T/tools/"
for t in $TOOLS; do cp "$SRC/$t" "$T/tools/"; done
# The fake memory reading: a later definition replaces the real one for every tool.
printf '\nmem_free_mb() { cat "$FAKE_MEM_FILE"; }\n' >>"$T/tools/lib.sh"
cp "$HERE/fixtures/fake-dev-server.mjs" "$T/app/"
cp "$HERE/fixtures/fake-dev-server.mjs" "$T/other/"
cp "$HERE/fixtures/vitest.mjs" "$T/app/node_modules/vitest/"
cp "$HERE/fixtures/vitest.mjs" "$T/other/node_modules/vitest/"

free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}
PORT=$(free_port)
PORT2=$(free_port)
[ "$PORT" != "$PORT2" ] || PORT2=$(free_port)

export APP_DIR="$T/app" RUNS_DIR="$T/runs" DEV_PORT="$PORT" DEV_HOST=127.0.0.1
export DEV_CMD="node $T/app/fake-dev-server.mjs $PORT"
export KEEPER_MIN_FREE_MB=2500 KEEPER_COOLDOWN_S=150 GUARD_MIN_FREE_MB=700 MEMGUARD_MIN_FREE_MB=1500
export FAKE_MEM_FILE="$T/mem"
mem() { echo "$1" >"$FAKE_MEM_FILE"; }
mem 9000

# port_pid and the defaults, from the same copied lib the tools use.
. "$T/tools/lib.sh"

run() { OUT=$(bash "$T/tools/$1" "${@:2}" 2>&1); CODE=$?; }
has() { echo "$OUT" | grep -q -- "$1"; }
alive() { kill -0 "$1" 2>/dev/null; }
# wait_until <seconds> <command...>
wait_until() {
  local n=0 max=$(($1 * 10))
  shift
  while [ "$n" -lt "$max" ]; do
    "$@" && return 0
    sleep 0.1
    n=$((n + 1))
  done
  "$@"
}
port_up() { [ -n "$(port_pid "$1")" ]; }
port_down() { [ -z "$(port_pid "$1")" ]; }
dead() { ! alive "$1"; }
pidfile_is() { [ "$(cat "$1" 2>/dev/null)" = "$2" ]; }
# Starts a fake dev server on port $2 with its working directory in $1; prints its PID.
serve() {
  (cd "$1" && exec node "$1/fake-dev-server.mjs" "$2" >/dev/null 2>&1 </dev/null) &
  local pid=$!
  wait_until 5 port_up "$2"
  echo "$pid"
}

# --- static checks ----------------------------------------------------------------------------
for t in $TOOLS; do
  check "static: bash -n $t" bash -n "$SRC/$t"
  check "static: $t sources lib.sh the standard way" grep -qF '. "$(cd "$(dirname "$0")" && pwd)/lib.sh"' "$SRC/$t"
  check "static: $t sets -u" grep -qx 'set -u' "$SRC/$t"
  OUT=$(grep -vE '^[[:space:]]*#' "$SRC/$t" | grep -nE '\b(pkill|pgrep)\b')
  check "static: $t runs no pkill or pgrep" test -z "$OUT"
  OUT=""
  run "$t" --bogus
  check "usage: $t --bogus exits 2 with a usage line" test "$CODE" -eq 2 -a -n "$(echo "$OUT" | grep '^usage:')"
done

# --- free-port.sh -----------------------------------------------------------------------------
run free-port.sh
check "free-port: no argument exits 2" test "$CODE" -eq 2
run free-port.sh abc
check "free-port: a non-numeric port exits 2" test "$CODE" -eq 2
run free-port.sh 70000
check "free-port: a port above 65535 exits 2" test "$CODE" -eq 2
run free-port.sh "$PORT" "$PORT2"
check "free-port: two ports exit 2" test "$CODE" -eq 2

run free-port.sh "$PORT2"
check "free-port: a free port exits 0 and says so" test "$CODE" -eq 0 -a -n "$(has 'is free' && echo y)"

SP=$(serve "$T/app" "$PORT2")
run free-port.sh "$PORT2"
check "free-port: an owner inside the app is stopped" test "$CODE" -eq 0
check "free-port: it printed the owner's PID and cwd first" has "cwd:     $(cd "$T/app" && pwd -P)"
check "free-port: the port is free afterwards" port_down "$PORT2"

SP=$(serve "$T/other" "$PORT2")
run free-port.sh "$PORT2"
check "free-port: an owner outside the app is left alone (exit 1)" test "$CODE" -eq 1
check "free-port: it says how to force it" has "free-port.sh $PORT2 --force"
check "free-port: the outside owner still runs" alive "$SP"
run free-port.sh --force "$PORT2"
check "free-port: --force (before the port) stops the outside owner" test "$CODE" -eq 0
check "free-port: the port is free after --force" port_down "$PORT2"

# --- dev-keeper.sh ----------------------------------------------------------------------------
KLOG="$T/runs/dev/keeper.log"
run dev-keeper.sh --once --stop
check "keeper: two modes exit 2" test "$CODE" -eq 2

run dev-keeper.sh --once
check "keeper: down + memory free -> starts the server" has "starting"
check "keeper: the server comes up on DEV_PORT" wait_until 10 port_up "$PORT"
check "keeper: the start stamp is written" test -s "$T/runs/dev/keeper.last"
check "keeper: the server log lives under RUNS_DIR" test -e "$T/runs/dev/dev-server.log"
SRV=$(port_pid "$PORT")
# The real working folder on both systems, as the tools read it: /proc on Linux, lsof on macOS.
srv_cwd() { readlink "/proc/$1/cwd" 2>/dev/null || lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; }
check "keeper: the server runs in APP_DIR" test "$(srv_cwd "$SRV")" = "$(cd "$T/app" && pwd -P)"
if command -v setsid >/dev/null 2>&1; then
  check "keeper: the server is detached in its own session" test "$(ps -o sid= -p "$SRV" | tr -d ' ')" != "$(ps -o sid= -p $$ | tr -d ' ')"
fi

run dev-keeper.sh --once
check "keeper: server up -> no second start" test "$(grep -c 'starting' "$KLOG")" -eq 1

kill "$SRV"
wait_until 5 port_down "$PORT"
run dev-keeper.sh --once
check "keeper: inside the cooldown -> no start" has "cooldown"
sleep 0.5
check "keeper: the port stays down during the cooldown" port_down "$PORT"

echo 0 >"$T/runs/dev/keeper.last"
mem 100
run dev-keeper.sh --once
check "keeper: low memory -> waits, no start" has "waiting for memory"
sleep 0.5
check "keeper: the port stays down while memory is low" port_down "$PORT"

mem 9000
run dev-keeper.sh --once
check "keeper: memory back -> starts again" wait_until 10 port_up "$PORT"
check "keeper: two starts logged in total" test "$(grep -c 'starting' "$KLOG")" -eq 2

echo "$$" >"$T/runs/dev/keeper.pid"
run dev-keeper.sh --status
check "keeper: a stale PID file is not taken for a running keeper" has "keeper not running"

bash "$T/tools/dev-keeper.sh" >/dev/null 2>&1 &
KP=$!
KILL_LATER="$KP"
wait_until 5 pidfile_is "$T/runs/dev/keeper.pid" "$KP"
run dev-keeper.sh
check "keeper: a second loop refuses to start (exit 1)" test "$CODE" -eq 1 -a -n "$(has 'already running' && echo y)"
run dev-keeper.sh --status
check "keeper: --status reports the loop and the port" has "keeper running (pid $KP)"
check "keeper: --status reports the port up" has "port $PORT up"
run dev-keeper.sh --stop
check "keeper: --stop ends the loop at once" wait_until 3 dead "$KP"
check "keeper: --stop removes the PID file" test ! -e "$T/runs/dev/keeper.pid"
check "keeper: --stop leaves the dev server running" port_up "$PORT"

# --- dev-guard.sh -----------------------------------------------------------------------------
GLOG="$T/runs/dev/guard.log"
mem 9000
run dev-guard.sh --once
check "guard: enough memory -> nothing to do" has "nothing to do"
check "guard: the server still runs" port_up "$PORT"

mem 100
run dev-guard.sh --once
check "guard: under the floor -> stops the dev server" wait_until 5 port_down "$PORT"
check "guard: the stop is logged under RUNS_DIR" grep -q "stopped the dev server" "$GLOG"

run dev-guard.sh --once
check "guard: under the floor, port already down -> says so" has "already down"

SP=$(serve "$T/other" "$PORT")
run dev-guard.sh --once
check "guard: a server outside the app is left alone" has "outside the app"
check "guard: that server still runs" alive "$SP"
kill "$SP" 2>/dev/null
wait_until 5 port_down "$PORT"

mem 9000
bash "$T/tools/dev-guard.sh" >/dev/null 2>&1 &
GP=$!
KILL_LATER="$KILL_LATER $GP"
wait_until 5 pidfile_is "$T/runs/dev/guard.pid" "$GP"
run dev-guard.sh
check "guard: a second loop refuses to start (exit 1)" test "$CODE" -eq 1
run dev-guard.sh --stop
check "guard: --stop ends the loop at once" wait_until 3 dead "$GP"

# --- vitest-memguard.sh -----------------------------------------------------------------------
# Fake runs, biggest tree first: app-tree (small main + a 100 MB worker), app-big (40 MB),
# app-small, and other (200 MB, outside the app: never a victim).
vt() {
  (cd "$1" && exec node "$1/node_modules/vitest/vitest.mjs" "$2" "$3" >/dev/null 2>&1 </dev/null) &
  echo $!
}
V_TREE=$(vt "$T/app" 0 100)
V_BIG=$(vt "$T/app" 40 0)
V_SMALL=$(vt "$T/app" 0 0)
V_OTHER=$(vt "$T/other" 200 0)
KILL_LATER="$KILL_LATER $V_TREE $V_BIG $V_SMALL $V_OTHER"
# Give each fake run time to fill its memory.
sleep 1.5
all_alive() { for p in "$@"; do alive "$p" || return 1; done; }

run vitest-memguard.sh --list
check "memguard: --list finds the 4 runs" test "$(echo "$OUT" | grep -c '^pid ')" -eq 4
check "memguard: --list marks 3 runs inside the app" test "$(echo "$OUT" | grep -c ' app ')" -eq 3

MLOG="$T/runs/dev/memguard.log"
mem 9000
run vitest-memguard.sh --once
check "memguard: enough memory -> nothing to do" has "nothing to do"
check "memguard: every run still alive" all_alive "$V_TREE" "$V_BIG" "$V_SMALL" "$V_OTHER"

mem 100
run vitest-memguard.sh --once
check "memguard: low memory -> the biggest tree (main + worker) goes first" wait_until 5 dead "$V_TREE"
check "memguard: the other runs survive that round" all_alive "$V_BIG" "$V_SMALL" "$V_OTHER"
check "memguard: the stop is logged with its size" grep -q "stopped vitest pid $V_TREE (its tree used" "$MLOG"
run vitest-memguard.sh --once
check "memguard: the next round takes the next biggest" wait_until 5 dead "$V_BIG"
check "memguard: the smallest survives that round" alive "$V_SMALL"
run vitest-memguard.sh --once
check "memguard: then the last one in the app" wait_until 5 dead "$V_SMALL"
run vitest-memguard.sh --once
check "memguard: nothing left in the app -> says so" has "no vitest run of this app"
check "memguard: the run outside the app is never stopped" alive "$V_OTHER"

# The loop runs inside the app with "vitest" in its own name: it must never pick itself.
(cd "$T/app" && exec bash "$T/tools/vitest-memguard.sh" >/dev/null 2>&1 </dev/null) &
MP=$!
KILL_LATER="$KILL_LATER $MP"
wait_until 5 pidfile_is "$T/runs/dev/memguard.pid" "$MP"
run vitest-memguard.sh --once
check "memguard: its own loop is not taken for a vitest run" has "no vitest run of this app"
sleep 1
check "memguard: the loop is still alive under low memory" alive "$MP"
run vitest-memguard.sh
check "memguard: a second loop refuses to start (exit 1)" test "$CODE" -eq 1
run vitest-memguard.sh --stop
check "memguard: --stop ends the loop at once" wait_until 3 dead "$MP"

# --- APP_DIR default --------------------------------------------------------------------------
# The tools live in <app>/scripts/tools: an empty APP_DIR means that app, not the git root of a monorepo.
if command -v git >/dev/null 2>&1; then
  M="$T/mono"
  mkdir -p "$M/apps/web/scripts/tools"
  git -C "$M" init -q
  cp "$SRC/lib.sh" "$SRC/tools.env" "$M/apps/web/scripts/tools/"
  OUT=$(cd "$M" && env -u APP_DIR -u RUNS_DIR bash -c '. "$1/lib.sh"; echo "$APP_DIR|$RUNS_DIR"' _ "$M/apps/web/scripts/tools")
  check "lib: an empty APP_DIR is the app above scripts/tools, not the monorepo root" test "$OUT" = "$M/apps/web|$M/apps/web/runs"
fi

# --- without ss and lsof ----------------------------------------------------------------------
# Git Bash and bare containers have neither. "Cannot tell" must never read as "the port is free".
NOPORT="$T/noport-bin"
mkdir -p "$NOPORT"
OLD_IFS=$IFS
IFS=:
for d in $PATH; do [ -d "$d" ] && ln -s "$d"/* "$NOPORT"/ 2>/dev/null; done
IFS=$OLD_IFS
rm -f "$NOPORT/ss" "$NOPORT/lsof"
run_np() { OUT=$(PATH="$NOPORT" bash "$T/tools/$1" "${@:2}" 2>&1); CODE=$?; }
lacks() { ! has "$1"; }
if PATH="$NOPORT" bash -c 'command -v ss || command -v lsof' >/dev/null 2>&1; then
  bad "no ss/lsof: the test could not hide ss and lsof"
else
  SP=$(serve "$T/app" "$PORT2")
  run_np free-port.sh "$PORT2"
  check "no ss/lsof: free-port exits 1 on a held port" test "$CODE" -eq 1
  check "no ss/lsof: free-port says the port cannot be checked" has "port $PORT2 cannot be checked"
  check "no ss/lsof: free-port never calls it free" lacks "is free"
  check "no ss/lsof: the port's owner still runs" alive "$SP"
  kill "$SP" 2>/dev/null
  wait_until 5 port_down "$PORT2"

  mem 9000
  echo 0 >"$T/runs/dev/keeper.last"
  run_np dev-keeper.sh --once
  check "no ss/lsof: the keeper starts no server" lacks "starting"
  check "no ss/lsof: the keeper says it cannot check the port" has "cannot check port $PORT"
  sleep 0.5
  check "no ss/lsof: the port stays down" port_down "$PORT"
  run_np dev-keeper.sh --status
  check "no ss/lsof: --status says the port cannot be checked" has "port $PORT: cannot check"
  check "no ss/lsof: --status never says down" lacks "port $PORT down"

  SG=$(serve "$T/app" "$PORT")
  KILL_LATER="$KILL_LATER $SG"
  mem 100
  run_np dev-guard.sh --once
  check "no ss/lsof: the guard says the port cannot be checked" has "cannot be checked"
  check "no ss/lsof: the guard never calls the port down" lacks "already down"
  check "no ss/lsof: the guard stops nothing" alive "$SG"
fi

echo
echo "tools-dev: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
