#!/usr/bin/env bash
# Tests for hooks/save-chat.mjs: pipes hook JSON on stdin, then checks stdout, the exit code and the copies.
# Also runs the "stop everything" backup commands of skills/session-rules/SKILL.md in a temp monorepo.
# Exits 0 only when every case passes. Works from any directory; writes only inside a mktemp -d folder.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/save-chat.mjs"
FIX="$HERE/fixtures/store"
ID="0b5e7d2a-1c3f-4e8a-9b6d-2f4a6c8e0a1b"

if [ "$#" -gt 0 ]; then
  echo "usage: $0   (runs every save-chat case)" >&2
  exit 2
fi
command -v node >/dev/null 2>&1 || { echo "node not found" >&2; exit 1; }

# The session running these tests may set the hook's variables: start from a clean slate.
unset CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_OPTION_SAVE_CHATS CLAUDE_PLUGIN_OPTION_CHATS_DIR SAVE_CHAT_BUDGET_MS

T="$(mktemp -d)"
trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT

PASS=0
FAIL=0
ok() { # ok "<name>" <test command...>
  local name=$1
  shift
  if "$@"; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $name"
  fi
}

# new_case <name>: a fresh project folder P and a transcript store S holding the fixture session.
new_case() {
  C="$T/$1"
  P="$C/project"
  S="$C/store"
  mkdir -p "$P" "$S"
  cp -R "$FIX/." "$S/"
  CHATS="$P/claude-chats"
}

# input <event> [extra JSON fields]: the hook JSON for the fixture session.
input() {
  printf '{"session_id":"%s","transcript_path":"%s","cwd":"%s","hook_event_name":"%s"%s}' \
    "$ID" "$S/$ID.jsonl" "$P" "$1" "${2:-}"
}

# run_hook <json> [VAR=value ...]: sets OUT, ERR and CODE.
run_hook() {
  local json=$1
  shift
  OUT="$(printf '%s' "$json" | env "$@" node "$HOOK" 2>"$T/stderr")"
  CODE=$?
  ERR="$(cat "$T/stderr")"
}

quiet_exit0() { [ "$CODE" -eq 0 ] && [ -z "$OUT" ]; }
mode_of() { node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$1"; }
same_mtime() {
  node -e 'const fs=require("fs");const a=fs.statSync(process.argv[1]).mtimeMs,b=fs.statSync(process.argv[2]).mtimeMs;process.exit(Math.abs(a-b)<1?0:1)' "$1" "$2"
}
log_lines() { [ -f "$1/copies.log" ] && wc -l <"$1/copies.log" | tr -d ' ' || echo 0; }
last_log() { tail -n 1 "$1/copies.log" 2>/dev/null; }
has() { grep -q -- "$2" <<<"$1"; }
lacks() { ! grep -q -- "$2" <<<"$1"; }
no_tmp_left() { [ -z "$(find "$1" -name '*.tmp' 2>/dev/null)" ]; }

# 1. First Stop run: main file, sibling folder, .gitignore, mode 700, one log line.
new_case basic
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "basic: exit 0, silent stdout" quiet_exit0
ok "basic: main transcript copied" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "basic: subagent file copied" cmp -s "$S/$ID/subagents/agent-a1.jsonl" "$CHATS/$ID/subagents/agent-a1.jsonl"
ok "basic: tool result copied" cmp -s "$S/$ID/tool-results/result-1.txt" "$CHATS/$ID/tool-results/result-1.txt"
ok "basic: .gitignore holds *" grep -qx '\*' "$CHATS/.gitignore"
ok "basic: .gitignore has a comment line" grep -q '^#' "$CHATS/.gitignore"
ok "basic: folder mode 700" [ "$(mode_of "$CHATS")" = "700" ]
ok "basic: copy mode 600" [ "$(mode_of "$CHATS/$ID.jsonl")" = "600" ]
ok "basic: copy keeps the source mtime" same_mtime "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "basic: one log line" [ "$(log_lines "$CHATS")" = "1" ]
L="$(last_log "$CHATS")"
ok "basic: log says Stop, copied, 2 files" has "$L" "event=Stop .*main=copied files=2 same=0"
ok "basic: no temp file left" no_tmp_left "$CHATS"

# 2. Second run with nothing changed: nothing copied, a second log line.
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "rerun: exit 0, silent" quiet_exit0
ok "rerun: two log lines" [ "$(log_lines "$CHATS")" = "2" ]
ok "rerun: main same, files 0, same 2" has "$(last_log "$CHATS")" "main=same files=0 same=2"

# 3. One file grows, one is new: only those two are copied.
printf '{"type":"assistant","message":{"content":"next turn"}}\n' >>"$S/$ID.jsonl"
printf '{"type":"user","agentId":"a1","message":{"content":"more"}}\n' >>"$S/$ID/subagents/agent-a1.jsonl"
printf 'new result\n' >"$S/$ID/tool-results/result-2.txt"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "incremental: exit 0, silent" quiet_exit0
ok "incremental: main copied again" has "$(last_log "$CHATS")" "main=copied files=2 same=1"
ok "incremental: grown main file matches" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "incremental: grown subagent file matches" cmp -s "$S/$ID/subagents/agent-a1.jsonl" "$CHATS/$ID/subagents/agent-a1.jsonl"
ok "incremental: new file copied" cmp -s "$S/$ID/tool-results/result-2.txt" "$CHATS/$ID/tool-results/result-2.txt"

# 4. Same size, new mtime: copied again.
printf 'page.tsx\nLAYOUT.tsx\n' >"$S/$ID/tool-results/result-1.txt"
touch -t 203001010000 "$S/$ID/tool-results/result-1.txt"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "same size, new mtime: copied" cmp -s "$S/$ID/tool-results/result-1.txt" "$CHATS/$ID/tool-results/result-1.txt"

# 5. save_chats off: nothing at all is written.
for v in false 0 no off OFF " Off " FALSE; do
  new_case "off-$(printf '%s' "$v" | tr -cd 'a-zA-Z0-9')-$RANDOM"
  run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_OPTION_SAVE_CHATS="$v"
  ok "off ($v): exit 0, silent" quiet_exit0
  ok "off ($v): no folder" [ ! -e "$CHATS" ]
done

# 6. save_chats on values.
for v in true 1 yes ""; do
  new_case "on-$(printf '%s' "$v" | tr -cd 'a-z0-9')-$RANDOM"
  run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_OPTION_SAVE_CHATS="$v"
  ok "on ('$v'): copied" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
done

# 7. A custom nested folder.
new_case custom
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_OPTION_CHATS_DIR="notes/chats"
ok "custom: exit 0, silent" quiet_exit0
ok "custom: copied into notes/chats" cmp -s "$S/$ID.jsonl" "$P/notes/chats/$ID.jsonl"
ok "custom: .gitignore there" grep -qx '\*' "$P/notes/chats/.gitignore"
ok "custom: default folder not made" [ ! -e "$CHATS" ]

# 8. Refused folders fall back to the default one and say so in the log.
for v in "../outside" "a/../../outside" "/abs/chats" "." "./" "C:\\chats"; do
  new_case "refused-$RANDOM"
  run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_OPTION_CHATS_DIR="$v"
  ok "refused ($v): exit 0, silent" quiet_exit0
  ok "refused ($v): saved in the default folder" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
  ok "refused ($v): logged" has "$(last_log "$CHATS")" "refused_dir="
  ok "refused ($v): nothing outside the project" [ ! -e "$C/outside" ]
  ok "refused ($v): no .gitignore at the project root" [ ! -e "$P/.gitignore" ]
done

# 9. A folder that belongs to the project (other files, no ignore-all .gitignore) is never used.
new_case foreign
mkdir -p "$P/src"
printf 'export {};\n' >"$P/src/index.ts"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_OPTION_CHATS_DIR="src"
ok "foreign: exit 0, silent" quiet_exit0
ok "foreign: no .gitignore written into src" [ ! -e "$P/src/.gitignore" ]
ok "foreign: no transcript in src" [ ! -e "$P/src/$ID.jsonl" ]
ok "foreign: saved in the default folder instead" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"

# 10. The default folder exists but is someone else's: nothing is copied anywhere.
new_case foreign-default
mkdir -p "$CHATS"
printf 'keep me\n' >"$CHATS/notes.txt"
printf 'notes.txt\n' >"$CHATS/.gitignore"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "foreign default: exit 0, silent" quiet_exit0
ok "foreign default: nothing copied" [ ! -e "$CHATS/$ID.jsonl" ]
ok "foreign default: .gitignore untouched" [ "$(cat "$CHATS/.gitignore")" = "notes.txt" ]

# 11. An empty folder made by hand is adopted.
new_case empty-folder
mkdir -p "$CHATS"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "empty folder: copied" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "empty folder: .gitignore added" grep -qx '\*' "$CHATS/.gitignore"

# 12. Project dir: CLAUDE_PROJECT_DIR wins; else the input cwd; else nothing.
new_case project-env
mkdir -p "$C/other"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$C/other"
ok "env project: used" cmp -s "$S/$ID.jsonl" "$C/other/claude-chats/$ID.jsonl"
ok "env project: cwd not used" [ ! -e "$CHATS" ]
new_case project-cwd
run_hook "$(input Stop)"
ok "cwd project: used" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
new_case project-none
run_hook "{\"session_id\":\"$ID\",\"transcript_path\":\"$S/$ID.jsonl\",\"hook_event_name\":\"Stop\"}"
ok "no project: exit 0, silent" quiet_exit0
ok "no project: nothing written" [ -z "$(find "$C" -name copies.log)" ]
new_case project-missing
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$C/does-not-exist"
ok "missing project dir: exit 0, silent" quiet_exit0
ok "missing project dir: not created" [ ! -e "$C/does-not-exist" ]

# 13. Bad input never fails.
new_case bad-input
for json in "not json" "" "[]" "null" '{"hook_event_name":"Stop"}' \
  "{\"session_id\":\"$ID\",\"transcript_path\":\"$S/notes.txt\",\"cwd\":\"$P\",\"hook_event_name\":\"Stop\"}"; do
  run_hook "$json" CLAUDE_PROJECT_DIR="$P"
  ok "bad input ($json): exit 0, silent" quiet_exit0
done
ok "bad input: nothing written" [ ! -e "$CHATS" ]

# 14. A missing transcript file: exit 0, logged as missing.
new_case missing-transcript
rm -f "$S/$ID.jsonl"
run_hook "$(input SessionEnd ',"reason":"other"')" CLAUDE_PROJECT_DIR="$P"
ok "missing transcript: exit 0, silent" quiet_exit0
ok "missing transcript: logged" has "$(last_log "$CHATS")" "event=SessionEnd reason=other .*main=missing"

# 15. An unsafe session id never becomes a path: the file name comes from the transcript instead.
new_case unsafe-id
run_hook "{\"session_id\":\"../../evil\",\"transcript_path\":\"$S/$ID.jsonl\",\"cwd\":\"$P\",\"hook_event_name\":\"Stop\"}" CLAUDE_PROJECT_DIR="$P"
ok "unsafe id: exit 0, silent" quiet_exit0
ok "unsafe id: saved under the transcript name" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "unsafe id: nothing outside" [ -z "$(find "$C" -name 'evil*')" ]

# 16. Symlinks in the sibling folder are not followed.
new_case symlink
printf 'secret\n' >"$C/outside-secret.txt"
ln -s "$C/outside-secret.txt" "$S/$ID/tool-results/link.txt"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "symlink: exit 0, silent" quiet_exit0
ok "symlink: not copied" [ ! -e "$CHATS/$ID/tool-results/link.txt" ]
ok "symlink: real files copied" [ -f "$CHATS/$ID/tool-results/result-1.txt" ]

# 17. A transcript path given with ~/ is expanded.
new_case home
mkdir -p "$C/home/.claude/projects/example-slug"
cp "$S/$ID.jsonl" "$C/home/.claude/projects/example-slug/"
run_hook "{\"session_id\":\"$ID\",\"transcript_path\":\"~/.claude/projects/example-slug/$ID.jsonl\",\"cwd\":\"$P\",\"hook_event_name\":\"PreCompact\",\"trigger\":\"manual\"}" HOME="$C/home"
ok "home: exit 0, silent" quiet_exit0
ok "home: copied" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "home: PreCompact trigger logged" has "$(last_log "$CHATS")" "event=PreCompact reason=manual"

# 18. Out of time: the main file is still copied first, the rest next run.
new_case budget
for i in $(seq 1 40); do printf 'r%s\n' "$i" >"$S/$ID/tool-results/extra-$i.txt"; done
run_hook "$(input SessionEnd)" CLAUDE_PROJECT_DIR="$P" SAVE_CHAT_BUDGET_MS=0
ok "budget: exit 0, silent" quiet_exit0
ok "budget: main copied" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "budget: logged partial" has "$(last_log "$CHATS")" "partial=yes"
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "budget: next run finishes" [ -f "$CHATS/$ID/tool-results/extra-40.txt" ]
ok "budget: next run not partial" lacks "$(last_log "$CHATS")" "partial=yes"

# 19. Speed: a 5 MB transcript and 300 sibling files inside the SessionEnd budget.
new_case speed
head -c 5000000 /dev/zero | tr '\0' 'x' >"$S/$ID.jsonl"
mkdir -p "$S/$ID/subagents/many"
for i in $(seq 1 300); do printf '{"n":%s}\n' "$i" >"$S/$ID/subagents/many/agent-$i.jsonl"; done
START_MS="$(node -e 'console.log(Date.now())')"
run_hook "$(input SessionEnd ',"reason":"prompt_input_exit"')" CLAUDE_PROJECT_DIR="$P"
END_MS="$(node -e 'console.log(Date.now())')"
WALL=$((END_MS - START_MS))
HOOK_MS="$(last_log "$CHATS" | sed -n 's/.* ms=\([0-9]*\).*/\1/p')"
ok "speed: exit 0, silent" quiet_exit0
ok "speed: all 302 sibling files copied" has "$(last_log "$CHATS")" "files=302 "
ok "speed: not partial" lacks "$(last_log "$CHATS")" "partial=yes"
ok "speed: hook work under 1000 ms (was ${HOOK_MS:-?})" [ "${HOOK_MS:-99999}" -lt 1000 ]
ok "speed: wall time under 1500 ms incl. node start (was ${WALL})" [ "$WALL" -lt 1500 ]
echo "speed: 5 MB + 302 files: hook ${HOOK_MS:-?} ms, wall ${WALL} ms"

# 20. The folder keeps itself out of git.
if command -v git >/dev/null 2>&1; then
  new_case git
  git -C "$P" init -q
  run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
  ok "git: nothing to commit" [ -z "$(git -C "$P" status --porcelain --untracked-files=all)" ]
else
  echo "skip: git not found"
fi

# 21. An unwritable project: exit 0, silent, no crash.
if [ "$(id -u)" != "0" ]; then
  new_case readonly
  chmod 500 "$P"
  run_hook "$(input PreCompact ',"trigger":"auto"')" CLAUDE_PROJECT_DIR="$P"
  ok "read-only project: exit 0, silent" quiet_exit0
  chmod 700 "$P"
else
  echo "skip: read-only case (running as root)"
fi

# 22. Wrong use by hand: a usage line on stderr, still exit 0 and nothing on stdout.
OUT="$(node "$HOOK" --help 2>"$T/stderr" </dev/null)"
CODE=$?
ok "usage: exit 0, silent stdout" quiet_exit0
ok "usage: line on stderr" grep -q '^usage:' "$T/stderr"

# 23. A home path or a variable is never expanded: it falls back to the default folder and is logged.
for v in "~/claude-chats" '$HOME/chats' '%USERPROFILE%\chats' 'chats-${USER}'; do
  new_case "unexpanded-$RANDOM"
  run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P" CLAUDE_PLUGIN_OPTION_CHATS_DIR="$v"
  ok "unexpanded ($v): exit 0, silent" quiet_exit0
  ok "unexpanded ($v): saved in the default folder" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
  ok "unexpanded ($v): logged" has "$(last_log "$CHATS")" "refused_dir="
  ok "unexpanded ($v): no other folder in the project" [ "$(ls -A "$P")" = "claude-chats" ]
done

# 24. Temp files left by a run stopped mid-copy: old ones go, a fresh one (a copy still running) stays.
new_case temps
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
NOW_MS="$(node -e 'console.log(Date.now())')"
OLD_MS=$((NOW_MS - 3600000))
OLD_TOP="$CHATS/.$ID.jsonl.4242.$OLD_MS.tmp"
OLD_SUB="$CHATS/$ID/subagents/.agent-a1.jsonl.4242.$OLD_MS.tmp"
OLD_OTHER="$CHATS/an-older-session/tool-results/.result-1.txt.77.$OLD_MS.tmp"
FRESH="$CHATS/.$ID.jsonl.4343.$NOW_MS.tmp"
mkdir -p "$(dirname "$OLD_OTHER")"
for f in "$OLD_TOP" "$OLD_SUB" "$OLD_OTHER" "$FRESH"; do printf 'half a copy\n' >"$f"; done
touch -t 200001010000 "$FRESH" # a running copy gets the source's old mtime just before its rename
printf 'keep\n' >"$CHATS/notes.1.2.tmp" # not the hook's temp name
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P" SAVE_CHAT_BUDGET_MS=0
ok "temps: no time left, nothing removed" [ -f "$OLD_TOP" ]
run_hook "$(input Stop)" CLAUDE_PROJECT_DIR="$P"
ok "temps: exit 0, silent" quiet_exit0
ok "temps: old temp at the top removed" [ ! -e "$OLD_TOP" ]
ok "temps: old temp in the session folder removed" [ ! -e "$OLD_SUB" ]
ok "temps: old temp in another session's folder removed" [ ! -e "$OLD_OTHER" ]
ok "temps: fresh temp kept, though its mtime is old" [ -f "$FRESH" ]
ok "temps: other files kept" [ -f "$CHATS/notes.1.2.tmp" ]
ok "temps: copies kept" cmp -s "$S/$ID.jsonl" "$CHATS/$ID.jsonl"
ok "temps: logged" has "$(last_log "$CHATS")" "swept=3"

# 25. The "stop everything" backup of skills/session-rules/SKILL.md, run from a subfolder of an app inside a
#     monorepo: it lands in the app's runs/, holds every untracked file of the repo, and restores on a clean clone.
SKILL="$HERE/../../skills/session-rules/SKILL.md"
if command -v git >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
  C="$T/stop-backup"
  R="$C/repo"
  APP="$R/apps/web"
  G=(git -c user.name=test -c user.email=test@example.com -c commit.gpgsign=false -c core.hooksPath=/dev/null)
  mkdir -p "$APP/src" "$APP/runs" "$R/packages/ui"
  git -C "$R" init -q
  printf '*\n' >"$APP/runs/.gitignore"
  printf 'export const a = 1;\n' >"$APP/src/page.ts"
  printf 'export const old = 1;\n' >"$R/packages/ui/old.ts"
  "${G[@]}" -C "$R" add -A
  "${G[@]}" -C "$R" commit -q -m base
  printf 'export const a = 2;\n' >"$APP/src/page.ts"
  rm "$R/packages/ui/old.ts"
  printf 'export const b = 1;\n' >"$APP/src/new.ts"
  printf 'export const v = 1;\n' >"$R/packages/ui/v.ts"
  printf 'notes\n' >"$R/top-new.txt"
  SNIP="$(awk '/^## 4\./ { s = 1 } s && /^ *```bash/ { b = 1; next } b && /^ *```/ { exit } b { print }' "$SKILL")"
  SNIP="${SNIP//<project>/$APP}"
  SNIP="${SNIP//<topic>/stop-test}"
  (cd "$APP/src" && bash -e -o pipefail -c "$SNIP") >"$T/snippet.out" 2>&1
  SNIP_CODE=$?
  BK="$(ls -d "$APP"/runs/stop-test/backups/stop-* 2>/dev/null | head -n 1)"
  TARLIST="$(tar -tzf "$BK/untracked.tgz" 2>/dev/null)"
  ok "stop backup: the commands run (exit $SNIP_CODE)" [ "$SNIP_CODE" -eq 0 ]
  ok "stop backup: tracked.diff in the app's runs/" [ -s "$BK/tracked.diff" ]
  ok "stop backup: no runs/ folder anywhere else" [ "$(find "$R" -name runs -type d | wc -l | tr -d ' ')" = "1" ]
  ok "stop backup: tar holds the app's new file" has "$TARLIST" '^apps/web/src/new\.ts$'
  ok "stop backup: tar holds another package's new file" has "$TARLIST" '^packages/ui/v\.ts$'
  ok "stop backup: tar holds the repo root's new file" has "$TARLIST" '^top-new\.txt$'
  ok "stop backup: tar does not hold the backup itself" lacks "$TARLIST" 'tracked\.diff'
  git clone -q "$R" "$C/clone" 2>/dev/null
  (cd "$C/clone" && git apply "$BK/tracked.diff" && tar -xzf "$BK/untracked.tgz") >/dev/null 2>&1
  ok "stop backup: restore on a clean clone gives the same status" \
    [ "$(git -C "$R" status --porcelain --untracked-files=all)" = "$(git -C "$C/clone" status --porcelain --untracked-files=all)" ]
  ok "stop backup: restored edit matches" cmp -s "$APP/src/page.ts" "$C/clone/apps/web/src/page.ts"
  ok "stop backup: restored new file matches" cmp -s "$R/top-new.txt" "$C/clone/top-new.txt"
else
  echo "skip: stop-everything backup (git or tar not found)"
fi

echo "save-chat: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
