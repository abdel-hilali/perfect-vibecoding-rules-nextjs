#!/usr/bin/env bash
# Tests for skills/recipes: the real folder must pass both checkers, and the bad fixtures must fail them
# for the right reasons. Works from any directory; writes only inside a temporary folder it removes.
# Usage: tests/recipes/run.sh
set -u

if [ "$#" -ne 0 ]; then
  echo "usage: $0" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SKILL="$ROOT/skills/recipes"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
ko() { fail=$((fail + 1)); echo "FAIL $1"; }

# expect_exit <want> <name> <command...>: runs the command, keeps its output in $TMP/out.
expect_exit() {
  want="$1"; name="$2"; shift 2
  "$@" >"$TMP/out" 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then ok "$name (exit $got)"; else ko "$name (exit $got, want $want)"; sed 's/^/     /' "$TMP/out"; fi
}

# expect_output <name> <fixed text>: the last command's output must contain the text.
expect_output() {
  if grep -qF -- "$2" "$TMP/out"; then ok "$1"; else ko "$1: output lacks \"$2\""; fi
}

expect_exit 0 "check-recipes.mjs parses" node --check "$HERE/check-recipes.mjs"
expect_exit 0 "check-code.mjs parses" node --check "$HERE/check-code.mjs"
expect_exit 0 "run.sh parses" bash -n "$HERE/run.sh"

expect_exit 2 "check-recipes without arguments prints usage" node "$HERE/check-recipes.mjs"
expect_output "usage line for check-recipes" "usage: node check-recipes.mjs"
expect_exit 2 "check-code without arguments prints usage" node "$HERE/check-code.mjs"
expect_output "usage line for check-code" "usage: node check-code.mjs"

# The real skill folder.
expect_exit 0 "skills/recipes passes check-recipes" node "$HERE/check-recipes.mjs" "$SKILL"
expect_exit 0 "skills/recipes code blocks parse" node "$HERE/check-code.mjs" "$SKILL"
if grep -q '^SKIP' "$TMP/out"; then
  echo "     (TypeScript not found: ts/tsx blocks were not parsed; set TYPESCRIPT_MODULE to check them)"
  ts_found=0
else
  ts_found=1
fi

# A bad skill folder, assembled in the temporary folder. The leaking URL and e-mail are built at run
# time, so this file itself stays free of them.
mkdir -p "$TMP/recipes"
cp "$HERE/fixtures/bad/SKILL.md.txt" "$TMP/recipes/SKILL.md"
cp "$HERE/fixtures/bad/broken.md.txt" "$TMP/recipes/broken.md"
printf 'See %s://%s/docs and write to %s@%s.\n' https leak.test someone mail.test >>"$TMP/recipes/broken.md"
expect_exit 1 "bad fixture fails check-recipes" node "$HERE/check-recipes.mjs" "$TMP/recipes" --no-expect
expect_output "flags an extra frontmatter key" "frontmatter keys not allowed: version"
expect_output "flags a description without 'Use when'" "no 'Use when' in description"
expect_output "flags a link to a missing file" "links to missing missing.md"
expect_output "flags a missing Traps section" 'section "## Traps" missing or out of order'
expect_output "flags a section out of order" 'section "## Code" missing or out of order'
expect_output "flags a missing Claude Code paragraph" "0 'In Claude Code:' paragraphs"
expect_output "flags Claude Code mechanics in a recipe" 'mentions "CLAUDE_"'
expect_output "flags a non-generic URL host" 'URL host "leak.test"'
expect_output "flags a non-generic e-mail" 'e-mail domain "mail.test"'

# The full set is expected on the real folder only: a folder with one recipe misses the others.
expect_exit 1 "a partial folder fails the full-set check" node "$HERE/check-recipes.mjs" "$TMP/recipes"
expect_output "names the missing recipes" "recipes missing: theme.md"

# A copy of the real folder with three faults: a dark token dropped, an unreadable on-colour, a domain
# folder outside src/lib/apis/ (built at run time, so a search of the kit for it finds none).
mkdir -p "$TMP/mutated"
cp -R "$SKILL" "$TMP/mutated/recipes"
awk '/^\.dark \{/ { dark = 1 } dark && /--outline:/ { dark = 0; next } { print }' "$SKILL/theme.md" |
  sed 's/^\(  --on-surface-muted:\) #[0-9a-fA-F]*;/\1 #ffffff;/' >"$TMP/mutated/recipes/theme.md"
stray="src/lib/$(printf 'in%s' voices)/"
echo "// ${stray}status.ts" >>"$TMP/mutated/recipes/traps.md"
expect_exit 1 "faulty copy fails check-recipes" node "$HERE/check-recipes.mjs" "$TMP/mutated/recipes"
expect_output "flags a token missing from .dark" "theme.md: --outline is set in :root but not in .dark"
expect_output "flags a low-contrast on-colour" "theme.md: --on-surface-muted on --surface-muted in light has contrast"
expect_output "flags a domain folder outside apis/" "traps.md: domain path \"$stray\" is outside"

# Code blocks that do not parse.
mkdir -p "$TMP/code"
cp "$HERE/fixtures/bad-code/sample.md.txt" "$TMP/code/sample.md"
expect_exit 1 "bad code fixture fails check-code" node "$HERE/check-code.mjs" "$TMP/code"
expect_output "flags unbalanced CSS" "sample.md:10 (css): braces do not balance"
expect_output "flags invalid JSON" "sample.md:15 (json):"
if [ "$ts_found" -eq 1 ]; then
  expect_output "flags a TypeScript syntax error" "sample.md:4 (ts):"
  if grep -qF "sample.md:19 (ts)" "$TMP/out"; then ko "valid TypeScript is not flagged"; else ok "valid TypeScript is not flagged"; fi
fi

# Rules of hooks and function sizes, checked with or without TypeScript. The same 54-line function is
# over the limit in src/lib/ (50) and within it in a component (190).
mkdir -p "$TMP/rules"
long_function() {
  printf '```ts\n// %s\nexport function tooLong(): number {\n  let total = 0;\n' "$1"
  for n in $(seq 1 50); do printf '  total += %s;\n' "$n"; done
  printf '  return total;\n}\n```\n\n'
}
{
  printf '# Rules\n\n```tsx\n// src/components/sample/bad-link.tsx\n'
  printf 'export function BadLink({ locale }: { locale?: string }) {\n  return locale ?? useLocale();\n}\n```\n\n'
  printf '```tsx\n// src/components/sample/good-link.tsx\n'
  printf 'export function GoodLink({ locale }: { locale?: string }) {\n  const fallback = useLocale();\n  return locale ?? fallback;\n}\n```\n\n'
  long_function "src/lib/sample/too-long.ts"
  long_function "src/components/sample/long-enough.tsx"
} >"$TMP/rules/rules.md"
expect_exit 1 "hook and size faults fail check-code" node "$HERE/check-code.mjs" "$TMP/rules"
expect_output "flags a hook called behind ??" "rules.md:4 (tsx): line 6: a hook is called conditionally"
expect_output "flags a lib function over 50 lines" "a function has 54 counted lines, over the 50 allowed in src/lib/sample/too-long.ts"
if grep -qF "rules.md:11 (tsx)" "$TMP/out"; then ko "a hook called first is not flagged"; else ok "a hook called first is not flagged"; fi
if grep -qF "long-enough.tsx" "$TMP/out"; then ko "a component keeps its 190-line limit"; else ok "a component keeps its 190-line limit"; fi

echo "recipes tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
