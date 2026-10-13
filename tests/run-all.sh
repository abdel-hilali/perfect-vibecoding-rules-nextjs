#!/usr/bin/env bash
# Runs every test area of the kit, plus the static checks, and prints one line per area.
# Exits 0 only when every area passes. Works from any directory. Each area writes only inside its own temporary
# folder; this script keeps the areas' output in one temporary folder, which it removes.
#
# usage: tests/run-all.sh [--verbose] [area ...]
#   areas: static code save-chat guard-bash tools-queue tools-dev recipes install (default: all of them)
#   --verbose prints each area's full output, not only the output of an area that failed.
# Optional settings, passed through to the areas:
#   ESLINT_DIR=<a project folder with node_modules/eslint>  runs the real-ESLint leg of the code tests
#   TYPESCRIPT_MODULE=<path of the typescript package>      parses the TypeScript samples of the recipes
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ALL_AREAS="static code save-chat guard-bash tools-queue tools-dev recipes install"
USAGE="usage: tests/run-all.sh [--verbose] [area ...]   (areas: $ALL_AREAS)"

verbose=0
areas=""
for arg in "$@"; do
  case "$arg" in
    -h | --help) echo "$USAGE"; exit 0 ;;
    -v | --verbose) verbose=1 ;;
    -*) echo "$USAGE" >&2; exit 2 ;;
    *)
      case " $ALL_AREAS " in
        *" $arg "*) areas="$areas $arg" ;;
        *) echo "unknown area: $arg" >&2; echo "$USAGE" >&2; exit 2 ;;
      esac
      ;;
  esac
done
[ -n "$areas" ] || areas=$ALL_AREAS

for tool in node python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "run-all: $tool is required" >&2; exit 1; }
done

LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT
# Python must not leave __pycache__ folders in the kit.
export PYTHONDONTWRITEBYTECODE=1

# The static checks: what a contributor breaks most often, checked in seconds without running anything.
static_checks() {
  local failed=0 f
  while IFS= read -r f; do
    bash -n "$f" || { echo "FAIL bash -n: ${f#"$ROOT"/}"; failed=1; }
  done < <(find "$ROOT" -name '*.sh' -not -path '*/.git/*' -not -path '*/node_modules/*')
  while IFS= read -r f; do
    node --check "$f" || { echo "FAIL node --check: ${f#"$ROOT"/}"; failed=1; }
  done < <(find "$ROOT" \( -name '*.mjs' -o -name '*.js' \) -not -path '*/.git/*' -not -path '*/node_modules/*')
  while IFS= read -r f; do
    python3 -I -c 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])' "$f" ||
      { echo "FAIL python syntax: ${f#"$ROOT"/}"; failed=1; }
  done < <(find "$ROOT" -name '*.py' -not -path '*/.git/*' -not -path '*/node_modules/*')
  echo "syntax: bash -n, node --check and the Python parser ran on every script"

  if command -v claude >/dev/null 2>&1; then
    (cd "$ROOT" && claude plugin validate .) || { echo "FAIL claude plugin validate ."; failed=1; }
  else
    echo "skip: claude plugin validate (the claude CLI is not on PATH)"
  fi

  # --input-type=module: Node 18 reads a script on stdin as CommonJS, and this one uses import.
  node --input-type=module - "$ROOT" <<'JS' || failed=1
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

const root = process.argv[2];
const problems = [];
const notes = [];
let checks = 0;
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
};
const files = walk(root);
const rel = (p) => relative(root, p).split(sep).join("/");
// Test fixtures are broken on purpose.
const fixture = (p) => /^tests\/[^/]+\/fixtures\//.test(rel(p));

// Every JSON file parses.
for (const file of files.filter((p) => p.endsWith(".json") && !fixture(p))) {
  checks += 1;
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`${rel(file)}: invalid JSON: ${error.message}`);
  }
}

// The plugin's ten skills exist, and every SKILL.md follows the skill format.
const SKILLS = ["code-rules", "recipes", "session-rules", "working-rules", "multi-agent", "tools", "dev", "gate",
  "screen", "new-project"];
for (const skill of SKILLS) {
  checks += 1;
  if (!existsSync(join(root, "skills", skill, "SKILL.md"))) problems.push(`skills/${skill}/SKILL.md is missing`);
}
const ALLOWED = new Set(["name", "description", "when_to_use", "argument-hint", "disable-model-invocation",
  "allowed-tools"]);
for (const file of files.filter((p) => basename(p) === "SKILL.md" && !fixture(p))) {
  checks += 1;
  const r = rel(file);
  const lines = readFileSync(file, "utf8").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 0) {
    problems.push(`${r}: the frontmatter must open with --- on line 1 and close with ---`);
    continue;
  }
  const fm = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!m) {
      problems.push(`${r}: not a "key: value" line: ${line}`);
      continue;
    }
    let value = m[2].trim();
    if (/^[>|]/.test(value)) problems.push(`${r}: ${m[1]}: write the value on one line`);
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    fm[m[1]] = value;
  }
  for (const key of Object.keys(fm)) if (!ALLOWED.has(key)) problems.push(`${r}: frontmatter key not allowed: ${key}`);
  const folder = basename(dirname(file));
  if (fm.name !== folder) problems.push(`${r}: name "${fm.name}" differs from its folder "${folder}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? "")) problems.push(`${r}: name must be lowercase kebab-case`);
  const description = fm.description ?? "";
  if (!description.includes("Use when")) problems.push(`${r}: the description needs a "Use when ..." part`);
  if (description.length > 600) problems.push(`${r}: the description has ${description.length} characters (600 at most)`);
  if ((description + (fm.when_to_use ?? "")).length > 1536) problems.push(`${r}: description + when_to_use over 1,536`);
  const body = lines.slice(end + 1).join("\n").trim().split("\n").length;
  if (body > 150) problems.push(`${r}: the body has ${body} lines: move detail into a supporting file`);
  else if (body > 120) notes.push(`${r}: the body has ${body} lines (about 120 is the target)`);
  // In a SKILL.md, "!" right before a backtick runs a shell command when Claude Code loads the skill.
  lines.forEach((line, n) => {
    if (/(^|\s)!`/.test(line) || /^\s*```!/.test(line)) problems.push(`${r}:${n + 1}: "!" before a backtick runs a command`);
  });
}

// Every file a hook points to exists.
checks += 1;
const hooks = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8")).hooks ?? {};
for (const [event, groups] of Object.entries(hooks)) {
  for (const hook of groups.flatMap((group) => group.hooks ?? [])) {
    for (const part of [hook.command, ...(hook.args ?? [])]) {
      if (typeof part === "string" && part.includes("${CLAUDE_PLUGIN_ROOT}")) {
        if (!existsSync(part.replace("${CLAUDE_PLUGIN_ROOT}", root))) problems.push(`hooks/hooks.json ${event}: ${part} not found`);
      }
    }
  }
}

// No script runs the full-match process killers (they match their own shell). Prose and the guard may name them.
const FULL_MATCH = /\bp(?:kill|grep)\s+(?:-[A-Za-z]*f[A-Za-z]*\b|--full\b)/;
for (const file of files.filter((p) => /\.(sh|mjs|py)$/.test(p) && /^(templates|install)/.test(rel(p)))) {
  checks += 1;
  readFileSync(file, "utf8").split("\n").forEach((line, n) => {
    if (!/^\s*(#|\/\/|\*)/.test(line) && FULL_MATCH.test(line)) problems.push(`${rel(file)}:${n + 1}: a full-match kill`);
  });
}

// Nothing from a real project: URLs, e-mail addresses and IP addresses stay generic. The one real URL allowed is
// the kit's own repository (the install commands, the plugin manifest), and only that exact address.
const HOSTS = [/^(.+\.)?example\.com$/, /^localhost$/, /^127\.0\.0\.1$/, /^app\.invalid$/];
const OWN_REPO = /^https:\/\/github\.com\/abdel-hilali\/perfect-vibecoding-rules-nextjs(\.git)?\/?$/;
for (const file of files) {
  if (statSync(file).size > 2_000_000) continue;
  const text = readFileSync(file, "utf8");
  if (text.includes("\u0000")) continue;
  checks += 1;
  for (const m of text.matchAll(/https?:\/\/([^\s/"'`<>)\]},;]+)[^\s"'`<>)\]},;]*/g)) {
    if (OWN_REPO.test(m[0].replace(/\.+$/, ""))) continue;
    const host = m[1].replace(/:.*$/, "").toLowerCase();
    if (!HOSTS.some((re) => re.test(host))) problems.push(`${rel(file)}: URL host "${host}" (use example.com)`);
  }
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g)) {
    if (!/^(.+\.)?example\.com$/i.test(m[1])) problems.push(`${rel(file)}: e-mail address at "${m[1]}" (use example.com)`);
  }
  for (const m of text.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)) {
    if (!["127.0.0.1", "0.0.0.0"].includes(m[0])) problems.push(`${rel(file)}: IP address ${m[0]}`);
  }
}

for (const note of notes) console.log(`note: ${note}`);
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(`static: ${checks} checks, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
JS
  return "$failed"
}

passed=0
failed=0
summary=""
for area in $areas; do
  log="$LOGS/$area.log"
  start=$SECONDS
  if [ "$area" = static ]; then
    static_checks >"$log" 2>&1
  else
    bash "$HERE/$area/run.sh" >"$log" 2>&1
  fi
  code=$?
  took=$((SECONDS - start))
  # The last line of each area is its own count of passed and failed cases.
  last="$(grep -v '^[[:space:]]*$' "$log" | tail -n 1)"
  if [ "$code" -eq 0 ]; then
    passed=$((passed + 1))
    line=$(printf 'ok    %-12s %4ss  %s' "$area" "$took" "$last")
    [ "$verbose" -eq 1 ] && cat "$log"
  else
    failed=$((failed + 1))
    line=$(printf 'FAIL  %-12s %4ss  exit %s: %s' "$area" "$took" "$code" "$last")
    echo "---- $area: full output"
    cat "$log"
    echo "---- end of $area"
  fi
  echo "$line"
  summary="$summary$line
"
done

echo
echo "== summary"
printf '%s' "$summary"
echo "run-all: $passed area(s) passed, $failed failed"
[ "$failed" -eq 0 ]
