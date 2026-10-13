#!/usr/bin/env bash
# Tests for install.mjs: runs it on throw-away app folders, then checks what it wrote, what it skipped, the
# placeholders it filled and its exit codes. It also runs the static scan of tests/run-all.sh on a small tree.
# Works from any directory; writes only inside a mktemp -d folder, which it removes. Exits 0 only when every
# case passes.
set -u

if [ "$#" -ne 0 ]; then
  echo "usage: $0   (runs every install case)" >&2
  exit 2
fi
command -v node >/dev/null 2>&1 || { echo "install: node not found" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$(cd "$HERE/../.." && pwd)"
INSTALL="$KIT/install.mjs"
T="$(mktemp -d)"
trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT
export PYTHONDONTWRITEBYTECODE=1
unset DEV_PORT CLAUDE_PROJECT_DIR

pass=0
fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; [ -s "$T/out" ] && sed 's/^/     | /' "$T/out" | head -15; }
# check <name> <command...>: passes when the command succeeds.
check() {
  local name=$1
  shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}
# run <args...>: runs the installer from an unrelated folder; output in $T/out, exit code in $CODE.
run() {
  (cd "$T" && node "$INSTALL" "$@") >"$T/out" 2>&1
  CODE=$?
}
code_is() { [ "$CODE" -eq "$1" ]; }
has() { grep -qF -- "$1" "$T/out"; }
lacks() { ! grep -qF -- "$1" "$T/out"; }
# new_app <name>: a folder that looks like a fresh Next.js app; sets P.
new_app() {
  P="$T/$1"
  mkdir -p "$P/src/app"
  printf '{ "name": "%s", "private": true }\n' "$1" >"$P/package.json"
  printf ':root {\n  --surface: #ffffff;\n}\n.dark {\n  --surface: #141317;\n}\n' >"$P/src/app/globals.css"
}
# sums <dir>: one line per file or link, with its checksum, to compare a tree before and after.
sums() {
  (cd "$1" && find . -type f -o -type l | LC_ALL=C sort | while read -r f; do
    if [ -L "$f" ]; then echo "$f link"; else echo "$f $(cksum <"$f")"; fi
  done)
}
# The files a fresh install must create: every template, every skill as a playbook, runs/.gitignore, and the
# .dockerignore and .gitattributes the installer writes.
expected_files() {
  (cd "$KIT/templates" && find . -type f ! -name '*.pyc' ! -name .DS_Store | sed 's|^\./||')
  (cd "$KIT/skills" && find . -type f ! -name '*.pyc' ! -name .DS_Store | sed 's|^\./|docs/playbooks/|')
  printf '%s\n' runs/.gitignore .dockerignore .gitattributes
}
CR="$(printf '\r')"
# lf_only <dir>: every .sh, .env, .py and .mjs file under it has LF line endings.
lf_only() {
  local f bad=0
  while IFS= read -r f; do
    if grep -q "$CR" "$f"; then echo "CRLF left in: ${f#"$1"/}"; bad=1; fi
  done < <(find "$1" -type f \( -name '*.sh' -o -name '*.env' -o -name '*.py' -o -name '*.mjs' \))
  return "$bad"
}
no_placeholder_left() { ! grep -rqE '\{\{(PROJECT_NAME|TODAY|DEV_PORT)\}\}' "$1"; }
port_from_lib() { bash -c 'unset DEV_PORT; . "$1/scripts/tools/lib.sh" && echo "$DEV_PORT"' _ "$1"; }
# Every template without a placeholder lands byte for byte (tools.env carries the port, so it is left out).
# Python caches are skipped, as the installer skips them.
templates_unchanged() {
  local f
  for f in $(cd "$KIT/templates" && grep -rLE '\{\{[A-Z_]+\}\}' .); do
    [ "$(basename "$f")" = tools.env ] && continue
    case "$f" in *__pycache__* | *.pyc) continue ;; esac
    cmp -s "$KIT/templates/$f" "$1/$f" || { echo "differs: $f"; return 1; }
  done
}
# Every project path that AGENTS.md and CLAUDE.md name in backticks exists after a full install.
named_paths_exist() {
  local p missing=0
  for p in $(grep -ohE '`(docs|scripts|\.claude)/[A-Za-z0-9_./-]+`' "$1/AGENTS.md" "$1/CLAUDE.md" | tr -d '`' | sort -u); do
    [ -e "$1/$p" ] || { echo "named but missing: $p"; missing=1; }
  done
  return "$missing"
}
# Each tool keeps the kit's execute bit: run directly when the kit's copy is executable, sourced (lib.sh) when not.
same_exec_bits() {
  local f
  for f in "$KIT"/templates/scripts/tools/*; do
    [ -f "$f" ] || continue
    local name="${f##*/}"
    if [ -x "$f" ] && [ ! -x "$1/scripts/tools/$name" ]; then echo "lost its execute bit: $name"; return 1; fi
    if [ ! -x "$f" ] && [ -x "$1/scripts/tools/$name" ]; then echo "gained an execute bit: $name"; return 1; fi
  done
  [ -x "$1/scripts/tools/q-tsc.sh" ]
}

echo "== arguments"
check "install.mjs parses" node --check "$INSTALL"
check "no child_process: no shell commands, the same on every system" bash -c '! grep -q child_process "$1"' _ "$INSTALL"
run --help
check "--help: exit 0 and the usage line" eval 'code_is 0 && has "usage: node install.mjs"'
run
check "no folder: exit 2 and the usage line" eval 'code_is 2 && has "usage: node install.mjs"'
run "$T/nowhere"
check "a missing folder: exit 2" eval 'code_is 2 && has "not a folder"'
new_app args-app
for bad_port in abc 0 70000 08080; do
  run "$P" --port "$bad_port"
  check "--port $bad_port: exit 2" eval 'code_is 2 && has "not a port number"'
done
run "$P" --port
check "--port without a value: exit 2" code_is 2
run "$P" --frobnicate
check "an unknown option: exit 2" eval 'code_is 2 && has "unknown option"'
run "$P" "$P"
check "two folders: exit 2" code_is 2
check "wrong arguments write nothing" test "$(ls -A "$P" | LC_ALL=C sort | tr '\n' ' ')" = "package.json src "
listing() { ls -A "$KIT" "$KIT/templates" "$KIT/templates/docs"; }
before="$(listing)"
run "$KIT"
check "the kit itself is refused: exit 2" eval 'code_is 2 && has "refused"'
run "$KIT/templates"
check "a folder inside the kit is refused: exit 2" eval 'code_is 2 && has "refused"'
check "a refusal writes nothing in the kit" test "$before" = "$(listing)"

echo "== a fresh install"
new_app fresh-app
day1="$(date +%F)"
run "$P"
day2="$(date +%F)"
check "exit 0" code_is 0
expected_files | LC_ALL=C sort >"$T/expected"
(cd "$P" && find . -type f | sed 's|^\./||' | grep -v -e '^package.json$' -e '^src/app/globals.css$' | LC_ALL=C sort) >"$T/got"
check "creates exactly the templates, the playbooks and runs/.gitignore" cmp -s "$T/expected" "$T/got"
check "the summary counts them" has "$(wc -l <"$T/expected" | tr -d ' ') created, 0 skipped"
check "lists each created file" has "created  docs/RULES.md"
check "prints the next steps" has "Next steps:"
check "AGENTS.md: the project name is the folder name" grep -qx '# fresh-app' "$P/AGENTS.md"
check "CLAUDE.md: line 1 imports AGENTS.md" test "$(head -1 "$P/CLAUDE.md")" = "@AGENTS.md"
check "CLAUDE.md: the project name" grep -q '^# Claude Code notes for fresh-app$' "$P/CLAUDE.md"
check "RULES.md: the project name" grep -q '^# fresh-app: the code rules' "$P/docs/RULES.md"
check "BACKEND-ASKS.md: the project name" grep -q 'Project: fresh-app\.' "$P/docs/BACKEND-ASKS.md"
check "PROGRESS.md: today's date" grep -qE "Opened ($day1|$day2)\." "$P/docs/PROGRESS.md"
check "BUILDER-RULES.md: the default port 3000" grep -q '(port 3000)' "$P/docs/BUILDER-RULES.md"
check "{{PURPOSE}} is left for the owner" grep -q '{{PURPOSE}}' "$P/AGENTS.md"
check "no other placeholder is left anywhere" no_placeholder_left "$P"
check "templates without placeholders land byte for byte" templates_unchanged "$P"
check "playbooks are the skills, byte for byte" diff -r "$KIT/skills" "$P/docs/playbooks"
check "the tools keep the kit's execute bits" same_exec_bits "$P"
check "tools.env keeps port 3000" grep -qF ': "${DEV_PORT:=3000}"' "$P/scripts/tools/tools.env"
check "runs/ ignores itself in git" grep -qx '\*' "$P/runs/.gitignore"
check ".dockerignore keeps the saved chats and runs/ out of images" eval 'grep -qx "claude-chats/" "$P/.dockerignore" && grep -qx "runs/" "$P/.dockerignore"'
check ".gitattributes keeps the shell tools LF" eval 'grep -qx "\*.sh text eol=lf" "$P/.gitattributes" && grep -qx "\*.py text eol=lf" "$P/.gitattributes" && grep -qx "scripts/tools/tools.env text eol=lf" "$P/.gitattributes"'
check "every path AGENTS.md and CLAUDE.md name exists" named_paths_exist "$P"
check "AGENTS.md lists a playbook for every skill" bash -c 'for s in "$2"/skills/*/; do s=${s%/}; grep -qF "docs/playbooks/${s##*/}/SKILL.md" "$1/AGENTS.md" || { echo "no row: ${s##*/}"; exit 1; }; done' _ "$P" "$KIT"

echo "== the installed project passes its own checks"
check "lib.sh reads DEV_PORT 3000" test "$(port_from_lib "$P")" = 3000
check "check-structure passes (every check waits for its folder)" bash -c 'cd "$1" && node scripts/check-structure.mjs >/dev/null' _ "$P"
check "check-i18n passes before messages/ exists" bash -c 'cd "$1" && node scripts/check-i18n.mjs >/dev/null' _ "$P"
check "check-json-dupes passes before messages/ exists" bash -c 'cd "$1" && python3 -I scripts/check-json-dupes.py messages >/dev/null' _ "$P"
check "check-theme passes on src/app/globals.css" bash -c 'cd "$1" && node scripts/check-theme.mjs >/dev/null' _ "$P"
check "the tools run: q-tsc.sh refuses arguments with exit 2" bash -c '"$1/scripts/tools/q-tsc.sh" extra >/dev/null 2>&1; [ $? -eq 2 ]' _ "$P"

echo "== a second run changes nothing"
sums "$P" >"$T/before"
run "$P"
check "exit 0" code_is 0
check "creates nothing" grep -q '^0 created, ' "$T/out"
check "lists what it skipped" has "skipped  AGENTS.md (already exists"
check "no file changed" eval 'sums "$P" | cmp -s "$T/before" -'
check "no merge warning for the kit's own AGENTS.md" lacks "merge the kit's rules"
check "no import warning for the kit's own CLAUDE.md" lacks "add the line @AGENTS.md"
check "no warning for the .dockerignore and .gitattributes it wrote" lacks "lacks these lines"

echo "== never overwrites"
new_app own-app
printf '# Our own rules\n' >"$P/AGENTS.md"
printf '# Our notes\n' >"$P/CLAUDE.md"
mkdir -p "$P/docs"
printf 'keep me\n' >"$P/docs/RULES.md"
ln -s "$T/link-target" "$P/docs/PROGRESS.md"
printf 'node_modules\n' >"$P/.dockerignore"
printf '*.png binary\n*.sh text eol=lf\n' >"$P/.gitattributes"
run "$P"
check "exit 0" code_is 0
check "an existing AGENTS.md is kept" test "$(cat "$P/AGENTS.md")" = "# Our own rules"
check "an existing CLAUDE.md is kept" test "$(cat "$P/CLAUDE.md")" = "# Our notes"
check "an existing docs/RULES.md is kept" test "$(cat "$P/docs/RULES.md")" = "keep me"
check "a dangling link is left as it is" test -L "$P/docs/PROGRESS.md"
check "the link is never followed" test ! -e "$T/link-target"
check "reports each skipped file" eval 'has "skipped  AGENTS.md" && has "skipped  docs/RULES.md" && has "skipped  docs/PROGRESS.md"'
check "asks to merge an AGENTS.md that lacks the kit's rules" has "merge the kit's rules into it by hand"
check "asks to import AGENTS.md from an existing CLAUDE.md" has "add the line @AGENTS.md"
check "still installs the rest" test -f "$P/docs/BUILDER-RULES.md"
check "an existing .dockerignore is kept" test "$(cat "$P/.dockerignore")" = "node_modules"
check "...and a warning names the two lines it lacks" eval 'has ".dockerignore was already there and lacks these lines" && has "      claude-chats/" && has "      runs/"'
check "an existing .gitattributes is kept" test "$(cat "$P/.gitattributes")" = "$(printf '*.png binary\n*.sh text eol=lf')"
check "...and a warning names only the lines it lacks" eval 'has "      *.py text eol=lf" && has "      scripts/tools/tools.env text eol=lf" && lacks "      *.sh text eol=lf"'
new_app ignore-app
printf '/claude-chats\nruns\n' >"$P/.dockerignore"
printf '* text=auto eol=lf\n' >"$P/.gitattributes"
run "$P"
check "no warning when they already hold the lines, in another form" eval 'code_is 0 && lacks "lacks these lines"'
new_app import-app
printf '@AGENTS.md\n\n# Our notes\n' >"$P/CLAUDE.md"
run "$P"
check "no import warning when CLAUDE.md already imports AGENTS.md" eval 'code_is 0 && lacks "add the line @AGENTS.md"'

echo "== --port"
new_app port-app
run "$P" --port 4321
check "exit 0" code_is 0
check "tools.env carries the port" grep -qF ': "${DEV_PORT:=4321}"' "$P/scripts/tools/tools.env"
check "lib.sh reads DEV_PORT 4321" test "$(port_from_lib "$P")" = 4321
check "BUILDER-RULES.md names the port" grep -q '(port 4321)' "$P/docs/BUILDER-RULES.md"
check "AGENTS.md names the port" grep -q 'port 4321' "$P/AGENTS.md"
check "PROGRESS.md names the port" grep -q 'port 4321' "$P/docs/PROGRESS.md"
check "the kit's tools.env is untouched" grep -qF ': "${DEV_PORT:=3000}"' "$KIT/templates/scripts/tools/tools.env"
printf '{"tool_name":"Bash","tool_input":{"command":"pnpm build"},"cwd":"%s"}' "$P" |
  CLAUDE_PROJECT_DIR="$P" node "$KIT/hooks/guard-bash.mjs" >"$T/out" 2>&1
check "the Bash hook reads the installed port" has "port 4321"
new_app port-eq-app
run "$P" --port=5173
check "--port=N works too" eval 'code_is 0 && grep -qF ": \"\${DEV_PORT:=5173}\"" "$P/scripts/tools/tools.env"'

echo "== options and odd folders"
new_app plugin-app
run "$P" --no-playbooks
check "--no-playbooks: exit 0" code_is 0
check "--no-playbooks: no docs/playbooks/" test ! -e "$P/docs/playbooks"
check "--no-playbooks: AGENTS.md and CLAUDE.md still there" test -f "$P/AGENTS.md" -a -f "$P/CLAUDE.md"
check "--no-playbooks: the next steps name the plugin command" has "/perfect-vibecoding-rules-nextjs:new-project"
new_app dry-app
sums "$P" >"$T/before"
run "$P" --dry-run
check "--dry-run: exit 0 and the plan" eval 'code_is 0 && has "would create  AGENTS.md"'
check "--dry-run: writes nothing" eval 'sums "$P" | cmp -s "$T/before" -'
new_app full-runs-app
mkdir -p "$P/runs/old"
printf 'log\n' >"$P/runs/old/log.txt"
run "$P"
check "a runs/ that holds files gets no .gitignore" test ! -e "$P/runs/.gitignore"
check "...and a warning instead" has "make sure git ignores it"
new_app empty-runs-app
mkdir -p "$P/runs"
run "$P"
check "an empty runs/ gets its .gitignore" test -f "$P/runs/.gitignore"
mkdir -p "$T/bare"
run "$T/bare"
check "no package.json: still installs, with a warning" eval 'code_is 0 && has "no package.json here" && test -f "$T/bare/AGENTS.md"'
new_app npm-app
: >"$P/package-lock.json"
run "$P"
check "an npm lockfile: the next steps name PM_EXEC=npx" has 'set PM_EXEC to "npx"'
new_app "spaced name app"
run "$P"
check "a folder name with spaces" eval 'code_is 0 && grep -qx "# spaced name app" "$P/AGENTS.md"'
new_app rel-app
(cd "$T" && node "$INSTALL" rel-app) >"$T/out" 2>&1
check "a relative folder works" test -f "$T/rel-app/AGENTS.md"
new_app blocked-app
printf 'a file\n' >"$P/docs"
run "$P"
check "a file where docs/ must go: exit 1, FAILED lines" eval 'code_is 1 && has "FAILED   docs/RULES.md"'
check "...and the rest still installed" test -f "$P/AGENTS.md"

echo "== a Windows clone of the kit (CRLF line endings)"
WK="$T/kit-crlf"
mkdir -p "$WK/skills"
cp "$INSTALL" "$WK/install.mjs"
cp -R "$KIT/templates" "$WK/templates"
# What a Windows checkout without .gitattributes holds: every text file with CRLF.
find "$WK/templates" -type f \( -name '*.sh' -o -name '*.env' -o -name '*.py' -o -name '*.mjs' -o -name '*.md' \) -print0 |
  xargs -0 node -e 'const fs = require("fs"); for (const f of process.argv.slice(1)) fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\r?\n/g, "\r\n"));'
check "the copy really holds CRLF" grep -q "$CR" "$WK/templates/scripts/tools/lib.sh"
new_app crlf-app
(cd "$T" && node "$WK/install.mjs" "$P" --no-playbooks --port 4567) >"$T/out" 2>&1
CODE=$?
check "exit 0" code_is 0
check ".sh, .env, .py and .mjs files land with LF line endings" lf_only "$P"
check "tools.env still carries the port" grep -qF ': "${DEV_PORT:=4567}"' "$P/scripts/tools/tools.env"
check "the tools run: q-tsc.sh prints its usage and exits 2" bash -c '"$1/scripts/tools/q-tsc.sh" extra >"$2" 2>&1; [ $? -eq 2 ] && grep -qi usage "$2" && ! grep -q "command not found" "$2"' _ "$P" "$T/tool-out"
check "the tools keep their execute bits" test -x "$P/scripts/tools/dev-keeper.sh"

echo "== a fresh create-next-app starter passes or skips every check script"
new_app starter-app
cp -R "$HERE/fixtures/starter/." "$P/"
run "$P"
check "exit 0" code_is 0
# in_app <dir> <command...>: runs the command in the app folder; its output goes to $T/out, shown on a failure.
in_app() { (cd "$1" && shift && "$@") >"$T/out" 2>&1; }
check "check-structure passes on the starter" in_app "$P" node scripts/check-structure.mjs
check "check-i18n skips: no messages/ yet" in_app "$P" node scripts/check-i18n.mjs
check "check-json-dupes skips: no messages/ yet" in_app "$P" python3 -I scripts/check-json-dupes.py messages
check "check-theme passes: the dark media query is the dark sheet" in_app "$P" node scripts/check-theme.mjs

echo "== run-all.sh: the static scan"
# Run the exact node command of run-all.sh and its script on a small tree. Module detection is turned off where
# this Node has it, as Node 18 lacks it: the scan must run there too.
{
  echo 'ROOT="$1"; failed=0'
  sed -n "/^  node .*<<'JS'/,/^JS\$/p" "$KIT/tests/run-all.sh"
  echo 'exit "$failed"'
} >"$T/static.sh"
NO_DETECT=""
node --no-experimental-detect-module -e 0 >/dev/null 2>&1 && NO_DETECT="--no-experimental-detect-module"
mkdir -p "$T/mini/hooks"
printf '{ "hooks": {} }\n' >"$T/mini/hooks/hooks.json"
cat >"$T/mini/good.md" <<'MD'
git clone https://github.com/abdel-hilali/perfect-vibecoding-rules-nextjs.git
"https://github.com/abdel-hilali/perfect-vibecoding-rules-nextjs"
See https://github.com/abdel-hilali/perfect-vibecoding-rules-nextjs.
MD
# The scheme is joined at run time, so the kit's own scan does not flag these planted URLs in this file.
S="https:"
printf '%s//github.com/someone/other-kit\n%s//github.com/abdel-hilali/perfect-vibecoding-rules-nextjs-fork\n%s//github.com/abdel-hilali/perfect-vibecoding-rules-nextjs/issues\n' "$S" "$S" "$S" >"$T/mini/bad.md"
NODE_OPTIONS="$NO_DETECT" bash "$T/static.sh" "$T/mini" >"$T/out" 2>&1
check "runs as an ES module, even without Node's module detection" has "static: "
check "the kit's own repository URL is allowed" lacks "good.md: URL"
check "every other GitHub URL is reported" test "$(grep -c 'bad.md: URL host "github.com"' "$T/out")" -eq 3

echo
echo "install: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
