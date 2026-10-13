#!/usr/bin/env bash
# Tests for the queued tools: q-tsc.sh, q-eslint.sh, q-vitest.sh, wait-milestone.sh and sweep-owners.py.
# They run against a stub package runner, fake journals and throw-away git repos inside one temp folder.
# Exit 0 only when every case passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/../../templates/scripts/tools" && pwd)"
FIX="$HERE/fixtures"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tools-queue.XXXXXX")"
LISTENER=""
cleanup() {
  [ -n "$LISTENER" ] && kill "$LISTENER" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
export PYTHONDONTWRITEBYTECODE=1

pass=0
failed=0
ok() { pass=$((pass + 1)); echo "ok    $1"; }
ko() {
  failed=$((failed + 1))
  echo "FAIL  $1"
  [ -n "${2:-}" ] && printf '%s\n' "$2" | head -25 | sed 's/^/      /'
}
skip() { echo "skip  $1"; }

# run CMD...: keeps the combined output in $out and the exit code in $code.
run() {
  out=$("$@" 2>&1)
  code=$?
}
# expect NAME CODE [PATTERN ...]: each PATTERN (grep -E) must match $out; a leading ! means it must not.
expect() {
  local name=$1 want=$2 p
  shift 2
  if [ "$code" != "$want" ]; then
    ko "$name (exit $code, expected $want)" "$out"
    return
  fi
  for p in "$@"; do
    case "$p" in
      '!'*)
        if printf '%s\n' "$out" | grep -qE -- "${p#!}"; then ko "$name (should not print: ${p#!})" "$out"; return; fi ;;
      *)
        if ! printf '%s\n' "$out" | grep -qE -- "$p"; then ko "$name (missing: $p)" "$out"; return; fi ;;
    esac
  done
  ok "$name"
}
digest() { cksum "$@" 2>/dev/null | awk '{print $1 $2}' | tr -d '\n'; }
new_repo() {
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" config user.email tests@example.com
  git -C "$1" config user.name tests
  git -C "$1" config commit.gpgsign false
}

# ---- environment shared by the tools: everything points into $TMP ----
APP="$TMP/app"
mkdir -p "$APP/src" "$APP/src/folder.test.ts" "$TMP/bin"
cp "$FIX/stub-pm.sh" "$TMP/bin/stub-pm"
chmod +x "$TMP/bin/stub-pm"
printf 'export const a = 1;\n' >"$APP/src/a.ts"
printf 'export const b = 2;\n' >"$APP/src/b.tsx"
printf 'test("a", () => {});\n' >"$APP/src/a.test.ts"
printf 'test("b", () => {});\n' >"$APP/src/b.spec.tsx"
export APP_DIR="$APP" PM_EXEC="$TMP/bin/stub-pm" HEAVY_LOCK="$TMP/heavy.lock" RUNS_DIR="$TMP/runs"
export TSC_MIN_FREE_MB=0 VITEST_MIN_FREE_MB=0 MEM_WAIT_ROUNDS=0 DEV_PORT=1 WAIT_POLL_S=1
unset TAIL_LINES STUB_EXIT STUB_LINES

# ---- static checks on the five tools ----
for t in q-tsc.sh q-eslint.sh q-vitest.sh wait-milestone.sh; do
  run bash -n "$TOOLS/$t"
  expect "$t: bash -n" 0
done
run python3 -I -c 'import ast, sys; ast.parse(open(sys.argv[1]).read())' "$TOOLS/sweep-owners.py"
expect "sweep-owners.py: parses" 0
notx=""
for t in q-tsc.sh q-eslint.sh q-vitest.sh wait-milestone.sh sweep-owners.py; do
  [ -x "$TOOLS/$t" ] || notx="$notx $t"
done
if [ -z "$notx" ]; then ok "the five tools are executable"; else ko "not executable:$notx"; fi
if grep -nE '^[^#]*\bp(kill|grep)[[:space:]]+-f' "$TOOLS"/q-*.sh "$TOOLS/wait-milestone.sh" "$TOOLS/sweep-owners.py" >/dev/null; then
  ko "a tool calls pkill or pgrep with the full-command flag"
else
  ok "no tool calls pkill or pgrep with the full-command flag"
fi

# ---- q-tsc.sh ----
run "$TOOLS/q-tsc.sh"
expect "q-tsc: runs tsc --noEmit in APP_DIR through PM_EXEC" 0 '^stub-pm: tsc --noEmit$' 'stub-cwd: .*/app$' '^tsc exit: 0$'
STUB_EXIT=3 run "$TOOLS/q-tsc.sh"
expect "q-tsc: passes tsc's exit code on" 3 '^tsc exit: 3$'
run "$TOOLS/q-tsc.sh" src/a.ts
expect "q-tsc: refuses arguments with a usage line" 2 '^usage: q-tsc.sh' '!stub-pm'
STUB_LINES=200 TAIL_LINES=10 run "$TOOLS/q-tsc.sh"
lines=$(printf '%s\n' "$out" | grep -c '^stub line')
if [ "$lines" = 10 ] && printf '%s\n' "$out" | grep -q '^stub line 200$'; then
  ok "q-tsc: prints only the tail (TAIL_LINES)"
else
  ko "q-tsc: tail kept $lines stub lines, expected the last 10" "$out"
fi
TSC_MIN_FREE_MB=999999999 run "$TOOLS/q-tsc.sh"
expect "q-tsc: says it waits for memory, then runs after MEM_WAIT_ROUNDS" 0 'waiting for 999999999 MB' '^tsc exit: 0$'
APP_DIR="$TMP/nowhere" run "$TOOLS/q-tsc.sh"
expect "q-tsc: refuses an APP_DIR that does not exist" 2 'is not a folder' '!stub-pm'
if command -v flock >/dev/null 2>&1; then
  (
    flock 9
    : >"$TMP/held"
    sleep 3
  ) 9>"$HEAVY_LOCK" &
  holder=$!
  i=0
  while [ ! -f "$TMP/held" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  t0=$(date +%s)
  run "$TOOLS/q-tsc.sh"
  t1=$(date +%s)
  wait "$holder"
  if [ "$code" = 0 ] && [ $((t1 - t0)) -ge 2 ]; then
    ok "q-tsc: waits for the heavy-check lock ($((t1 - t0)) s behind a 3 s holder)"
  else
    ko "q-tsc: did not wait for the lock (exit $code, $((t1 - t0)) s)" "$out"
  fi
else
  skip "q-tsc: lock queue (flock is not installed here; the tools then run unqueued)"
fi

# ---- q-eslint.sh ----
run "$TOOLS/q-eslint.sh"
expect "q-eslint: no file gives a usage line" 2 '^usage: q-eslint.sh'
run "$TOOLS/q-eslint.sh" src/a.ts src/b.tsx
expect "q-eslint: lints the files with --max-warnings=0" 0 '^stub-pm: eslint --max-warnings=0 src/a.ts src/b.tsx$' '^eslint exit: 0$'
STUB_EXIT=1 run "$TOOLS/q-eslint.sh" "$APP/src/a.ts"
expect "q-eslint: takes absolute paths and passes the exit code on" 1 '^eslint exit: 1$'
run "$TOOLS/q-eslint.sh" src
expect "q-eslint: refuses a folder" 2 'is a folder' '!stub-pm'
run "$TOOLS/q-eslint.sh" src/missing.ts
expect "q-eslint: refuses a missing file" 2 'not found' '!stub-pm'
run "$TOOLS/q-eslint.sh" --fix src/a.ts
expect "q-eslint: refuses options" 2 'is an option' '!stub-pm'

# ---- q-vitest.sh ----
run "$TOOLS/q-vitest.sh"
expect "q-vitest: no file gives a usage line" 2 '^usage: q-vitest.sh'
run "$TOOLS/q-vitest.sh" src/a.test.ts src/b.spec.tsx
expect "q-vitest: runs the test files with two workers" 0 '^stub-pm: vitest run src/a.test.ts src/b.spec.tsx --maxWorkers=2$' '^vitest exit: 0$'
STUB_EXIT=1 run "$TOOLS/q-vitest.sh" src/a.test.ts
expect "q-vitest: passes vitest's exit code on" 1 '^vitest exit: 1$'
run "$TOOLS/q-vitest.sh" src
expect "q-vitest: refuses a folder" 2 'not a test FILE' '!stub-pm'
run "$TOOLS/q-vitest.sh" .
expect "q-vitest: refuses the whole project" 2 'not a test FILE' '!stub-pm'
run "$TOOLS/q-vitest.sh" src/a.ts
expect "q-vitest: refuses a source file" 2 'not a test FILE' '!stub-pm'
run "$TOOLS/q-vitest.sh" src/a.test.ts src/a.ts
expect "q-vitest: refuses the whole call when one argument is wrong" 2 'not a test FILE' '!stub-pm'
run "$TOOLS/q-vitest.sh" src/folder.test.ts
expect "q-vitest: refuses a folder named like a test file" 2 'not a file' '!stub-pm'
run "$TOOLS/q-vitest.sh" src/gone.test.ts
expect "q-vitest: refuses a missing test file" 2 'not a file' '!stub-pm'
run "$TOOLS/q-vitest.sh" -t name src/a.test.ts
expect "q-vitest: refuses options" 2 'is an option' '!stub-pm'

# ---- wait-milestone.sh ----
J="$TMP/journal.jsonl"
cp "$FIX/journal-running.jsonl" "$J"
printf 'one\ntwo\nthree\n' >"$TMP/B1.md"
new_repo "$APP"
git -C "$APP" add src/a.ts && git -C "$APP" commit -qm init
printf 'export const a = 2;\n' >"$APP/src/a.ts"
run "$TOOLS/wait-milestone.sh"
expect "wait-milestone: no journal gives a usage line" 2 '^usage: wait-milestone.sh'
run "$TOOLS/wait-milestone.sh" "$J" 1 "$TMP/B1.md" "$TMP/B2.md"
expect "wait-milestone: wakes on the timer with a short status" 0 'TIMER: 1 s passed' \
  'agents: 2 started, 0 returned a result' 'B1.md: 3 lines, last write [0-9:]+' 'B2.md: not written yet' \
  'memory: [0-9]+ MB free' 'dev port 1: DOWN'
# changed paths in APP: src/a.ts modified + src/b.tsx, the two tests and nothing else untracked
expect "wait-milestone: counts the changed paths in APP_DIR" 0 'app: 4 changed path\(s\)'
run "$TOOLS/wait-milestone.sh" "$TMP/none.jsonl" 1
expect "wait-milestone: a journal not written yet is not an error" 0 'TIMER' 'journal: not found yet'
t0=$(date +%s)
"$TOOLS/wait-milestone.sh" "$J" 30 >"$TMP/wait.out" 2>&1 &
waiter=$!
sleep 2
cat "$FIX/journal-running.jsonl" "$FIX/journal-ended.jsonl" >"$TMP/journal.next"
mv "$TMP/journal.next" "$J"
wait "$waiter"
code=$?
t1=$(date +%s)
out=$(cat "$TMP/wait.out")
expect "wait-milestone: wakes when an agent ends, and names it" 0 'MILESTONE: 2 agent event' \
  'agents: 2 started, 1 returned a result, 1 other end event' 'result \| build:A' \
  'error \| build:B \| agent stopped: out of memory'
if [ $((t1 - t0)) -lt 15 ]; then ok "wait-milestone: woke in $((t1 - t0)) s, not at the 30 s timer"; else ko "wait-milestone: took $((t1 - t0)) s"; fi
if command -v python3 >/dev/null 2>&1; then
  python3 -I -c '
import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen(1)
print(s.getsockname()[1], flush=True)
time.sleep(60)
' >"$TMP/port" &
  LISTENER=$!
  i=0
  while [ ! -s "$TMP/port" ] && [ "$i" -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  port=$(cat "$TMP/port")
  seen=$(bash -c '. "$1/lib.sh"; port_pid "$2"' _ "$TOOLS" "$port")
  if [ -n "$seen" ]; then
    DEV_PORT=$port run "$TOOLS/wait-milestone.sh" "$J" 1
    expect "wait-milestone: reports the dev port up with its PID" 0 "dev port $port: up \\(pid $LISTENER\\)"
  else
    skip "wait-milestone: dev port up (this machine does not show listening PIDs to port_pid)"
  fi
  kill "$LISTENER" 2>/dev/null
  LISTENER=""
fi
# Without ss and lsof (Git Bash, a bare container) nothing can tell: the status must not say DOWN.
NOPORT="$TMP/noport-bin"
mkdir -p "$NOPORT"
old_ifs=$IFS
IFS=:
for d in $PATH; do [ -d "$d" ] && ln -s "$d"/* "$NOPORT"/ 2>/dev/null; done
IFS=$old_ifs
rm -f "$NOPORT/ss" "$NOPORT/lsof"
if PATH="$NOPORT" bash -c 'command -v ss || command -v lsof' >/dev/null 2>&1; then
  ko "wait-milestone: the test could not hide ss and lsof"
else
  run env PATH="$NOPORT" bash "$TOOLS/wait-milestone.sh" "$J" 1
  expect "wait-milestone: without ss or lsof the dev port is unknown, not DOWN" 0 \
    'dev port 1: unknown \(no ss or lsof\)' '!DOWN' '!port_pid:'
fi

# ---- sweep-owners.py ----
SW="$TOOLS/sweep-owners.py"
R="$TMP/repo"
new_repo "$R"
mkdir -p "$R/src" "$R/tests/t"
for f in src/a.ts src/b.ts src/keep.ts tests/t/one.sh; do printf 'x\n' >"$R/$f"; done
git -C "$R" add -A && git -C "$R" commit -qm init
printf 'y\n' >"$R/src/a.ts"
rm "$R/src/b.ts"
printf 'new\n' >"$R/src/c.ts"
printf 'new\n' >"$R/src/stray.ts"
printf 'new\n' >"$R/src/space name.ts"
printf 'new\n' >"$R/tests/t/two.sh"
# The wave journal gets one broken line, as a journal cut by a crash would have.
WAVE="$TMP/wave.jsonl"
{ head -n 4 "$FIX/journal-wave.jsonl"; echo "not a json line"; tail -n +5 "$FIX/journal-wave.jsonl"; } >"$WAVE"
git -C "$R" status >/dev/null # settle the index once, so only the sweep could change it from here
before_sum=$(digest "$R/.git/index" "$WAVE")
before_status=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" status --porcelain --untracked-files=all)

run python3 -I "$SW"
expect "sweep-owners: no journal gives a usage line" 2 '^usage: python3 -I sweep-owners.py'
run python3 -I "$SW" --repo
expect "sweep-owners: --repo without a folder gives a usage line" 2 '^usage:'
run python3 -I "$SW" --repo "$TMP/bin" "$WAVE"
expect "sweep-owners: refuses a folder outside git" 2 'not inside a git work tree'
run python3 -I "$SW" --repo "$R" "$TMP/missing.jsonl"
expect "sweep-owners: refuses a journal it cannot read" 2 'cannot read'

run python3 -I "$SW" --repo "$R" "$WAVE"
expect "sweep-owners: a wave with a stray file and a double claim fails" 1 \
  'changed paths: 6' 'agent results: 3 · unreadable lines: 1' \
  'UNCLAIMED \(changed, no agent names it\): 1' '^ +\?\? src/stray.ts$' \
  'CLAIMED BY MORE THAN ONE AGENT: 1' 'src/a.ts <- build:A, build:B +\[same run: a conflict\]' \
  'TOUCHED OUTSIDE THEIR LIST: 1' 'src/keep.ts <- build:B' \
  'claimed but not changed.*: 2' 'src/ghost.ts <- build:C' \
  '!src/c.ts' '!src/space name.ts' '!tests/t/two.sh' '!src/b.ts'

printf '%s\n' '{"type":"started","agentId":"f1","label":"finish"}' \
  "{\"type\":\"result\",\"agentId\":\"f1\",\"result\":{\"files_changed\":[\"$R/src/stray.ts\",\"/elsewhere/notes.md\"],\"files_created\":[],\"files_deleted\":[],\"touched_outside_list\":[]}}" \
  >"$TMP/finish.jsonl"
run python3 -I "$SW" --repo "$R" "$WAVE" "$TMP/finish.jsonl"
expect "sweep-owners: reads several journals, absolute claims and claims outside the repo" 1 \
  'journals: 2' 'claims outside the repo: 1' 'UNCLAIMED.*: 0' 'src/a.ts <- build:A \(journal 1\), build:B \(journal 1\)'

after_sum=$(digest "$R/.git/index" "$WAVE")
after_status=$(GIT_OPTIONAL_LOCKS=0 git -C "$R" status --porcelain --untracked-files=all)
if [ "$before_status" = "$after_status" ] && [ "$before_sum" = "$after_sum" ]; then
  ok "sweep-owners: read-only (tree, index and journal unchanged)"
else
  ko "sweep-owners: something changed during the sweep"
fi

R2="$TMP/repo2"
new_repo "$R2"
printf 'x\n' >"$R2/a.ts" && git -C "$R2" add -A && git -C "$R2" commit -qm init
printf 'y\n' >"$R2/a.ts"
printf '%s\n' '{"type":"started","agentId":"x","label":"build:X"}' \
  '{"type":"result","agentId":"x","result":{"files_changed":["./a.ts"],"files_created":[],"files_deleted":[],"touched_outside_list":[]}}' \
  >"$TMP/clean.jsonl"
run python3 -I "$SW" --repo "$R2" "$TMP/clean.jsonl"
expect "sweep-owners: a clean wave passes" 0 'UNCLAIMED.*: 0' 'CLAIMED BY MORE THAN ONE AGENT: 0' 'claimed but not changed.*: 0'
printf '%s\n' '{"type":"started","agentId":"y","label":"fix:Y"}' \
  '{"type":"result","agentId":"y","result":"{\"files_changed\":[\"a.ts\"]}"}' >"$TMP/later.jsonl"
run python3 -I "$SW" --repo "$R2" "$TMP/clean.jsonl" "$TMP/later.jsonl"
expect "sweep-owners: a hand-over between two runs is listed, not failed" 0 \
  'a.ts <- build:X \(journal 1\), fix:Y \(journal 2\)$' '!same run'
(cd "$TMP" && APP_DIR="$R2" python3 -I "$SW" "$TMP/clean.jsonl" >"$TMP/env.out" 2>&1)
code=$?
out=$(cat "$TMP/env.out")
expect "sweep-owners: defaults to APP_DIR" 0 "repo: .*repo2 · changed paths: 1"

R3="$TMP/mono"
new_repo "$R3"
mkdir -p "$R3/app/src" "$R3/other"
printf 'x\n' >"$R3/app/src/x.ts" && printf 'x\n' >"$R3/other/y.ts"
git -C "$R3" add -A && git -C "$R3" commit -qm init
printf 'y\n' >"$R3/app/src/x.ts" && printf 'y\n' >"$R3/other/y.ts"
printf '%s\n' '{"type":"result","agentId":"m","result":{"id":"M","files_changed":["src/x.ts"]}}' >"$TMP/mono.jsonl"
run python3 -I "$SW" --repo "$R3/app" "$TMP/mono.jsonl"
expect "sweep-owners: --repo on a subfolder sweeps only that folder" 0 'changed paths: 1' 'UNCLAIMED.*: 0' '!other/y.ts'

# Without --repo and APP_DIR, the sweep takes the app the way the bash tools do (tools.env, else two folders up),
# not the folder it was started from: from a monorepo's root, every app-relative claim would be UNCLAIMED.
R4="$TMP/mono4"
new_repo "$R4"
mkdir -p "$R4/apps/web/scripts/tools" "$R4/apps/web/src" "$R4/other" "$TMP/loose/scripts/tools"
cp "$SW" "$TOOLS/tools.env" "$R4/apps/web/scripts/tools/"
printf 'x\n' >"$R4/apps/web/src/x.ts" && printf 'x\n' >"$R4/other/y.ts"
git -C "$R4" add -A && git -C "$R4" commit -qm init
printf 'y\n' >"$R4/apps/web/src/x.ts" && printf 'y\n' >"$R4/other/y.ts"
printf '%s\n' '{"type":"result","agentId":"w","result":{"id":"W","files_changed":["src/x.ts"]}}' >"$TMP/web.jsonl"
(cd "$R4" && env -u APP_DIR python3 -I apps/web/scripts/tools/sweep-owners.py "$TMP/web.jsonl" >"$TMP/sw4.out" 2>&1)
code=$?
out=$(cat "$TMP/sw4.out")
expect "sweep-owners: no APP_DIR -> the app two folders above the script, not the current folder" 0 \
  'repo: .*/mono4/apps/web · changed paths: 1' 'UNCLAIMED.*: 0' '!other/y.ts'
cp "$SW" "$TMP/loose/scripts/tools/"
printf ': "${APP_DIR:=%s}"\n' "$R4/apps/web" >"$TMP/loose/scripts/tools/tools.env"
(cd "$R4" && env -u APP_DIR python3 -I "$TMP/loose/scripts/tools/sweep-owners.py" "$TMP/web.jsonl" >"$TMP/sw5.out" 2>&1)
code=$?
out=$(cat "$TMP/sw5.out")
expect "sweep-owners: no APP_DIR in the environment -> the APP_DIR set in tools.env" 0 \
  'repo: .*/mono4/apps/web · changed paths: 1' 'UNCLAIMED.*: 0'
printf '%s\n' '{"type":"result","agentId":"v","result":{"id":"V","files_changed":["src\\x.ts"]}}' >"$TMP/back.jsonl"
run python3 -I "$SW" --repo "$R4/apps/web" "$TMP/back.jsonl"
expect "sweep-owners: a claim written with backslashes matches git's forward slashes" 0 'UNCLAIMED.*: 0' \
  'claimed but not changed.*: 0'
# -B: importing the module must not leave a __pycache__ in the kit (-I ignores PYTHONDONTWRITEBYTECODE).
run python3 -I -B - "$SW" <<'PY'
import importlib.util, ntpath, os, sys, types
spec = importlib.util.spec_from_file_location("sweep_owners", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
# Windows path rules for this module only, as Windows Python would apply them.
mod.os = types.SimpleNamespace(path=ntpath, sep="\\", environ=os.environ, getcwd=os.getcwd)
print("normalized:", mod.normalize("src/a.ts", "C:\\repo"), mod.normalize("tests/area/**", "C:\\repo"),
      mod.normalize("C:\\repo\\src\\b.ts", "C:\\repo"))
PY
expect "sweep-owners: under Windows path rules a claim keeps git's forward slashes" 0 \
  '^normalized: src/a.ts tests/area/ src/b.ts$'

echo
echo "tools-queue: $pass passed, $failed failed"
[ "$failed" -eq 0 ]
