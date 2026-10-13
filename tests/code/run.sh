#!/usr/bin/env bash
# Tests for the code-rules scripts in templates/scripts/: check-structure.mjs,
# check-i18n.mjs, check-json-dupes.py, check-theme.mjs and eslint-rules.mjs.
# Works from any directory, writes only inside a temporary folder, and exits 0
# only when every case passes. The real-ESLint leg runs when ESLint can be
# found (ESLINT_DIR=<a project folder with node_modules/eslint>), else it is skipped.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$(cd "$HERE/../.." && pwd)"
SCRIPTS="$KIT/templates/scripts"
FIX="$HERE/fixtures"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
skip=0
OUT="$TMP/out"

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; sed 's/^/       | /' "$OUT" | head -40; }

# expect NAME EXIT CMD...: runs CMD (output kept in $OUT) and checks its exit code.
expect() {
  local name="$1" want="$2"
  shift 2
  "$@" >"$OUT" 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then ok "$name"; else bad "$name (exit $got, wanted $want)"; fi
}
# has NAME TEXT: the last output contains TEXT.  lacks NAME TEXT: it does not.
has() { if grep -qF -- "$2" "$OUT"; then ok "$1"; else bad "$1 (missing: $2)"; fi; }
lacks() { if grep -qF -- "$2" "$OUT"; then bad "$1 (unexpected: $2)"; else ok "$1"; fi; }

echo "== syntax"
for f in check-structure.mjs check-i18n.mjs check-theme.mjs eslint-rules.mjs; do
  expect "node --check $f" 0 node --check "$SCRIPTS/$f"
done
expect "python3 parses check-json-dupes.py" 0 python3 -I -c 'import ast, sys; ast.parse(open(sys.argv[1]).read())' "$SCRIPTS/check-json-dupes.py"

echo "== check-structure"
S="$SCRIPTS/check-structure.mjs"
expect "good project passes" 0 node "$S" "$FIX/structure/good"
has "good project: pass line" "structure check passed"
mkdir -p "$TMP/empty"
expect "empty project passes (every check skipped)" 0 node "$S" "$TMP/empty"
has "empty project: says what it skipped" "skipped domains: src/lib/apis/ does not exist yet"
expect "bad project fails" 1 node "$S" "$FIX/structure/bad"
has "extra file in a domain" "src/lib/apis/projects/helpers.ts"
has "extra file message" "not one of the domain files"
has "loose file in the domains folder" "src/lib/apis/stray.ts"
has "domain folder without source" "domain folder has no source file"
has "route not delegating to the relay" "a route file is one call to the shared relay: proxy(...)"
has "hand-rolled cookie forwarding" "hand-rolled cookie or CSRF forwarding"
has "id not last" '"members" comes after a dynamic segment'
has "non-route file under the api folder" "src/app/api/projects/helpers.ts"
has "PascalCase file name" "src/components/shared/ProjectCard.tsx"
has "component folder with no route" 'no route segment named "billing"'
has "client constant through a barrel" 'imports SORT_ORDER from the "use client" module src/components/shared/sort-order.tsx'
lacks "route groups do not count as segments" '"auth" comes after'
expect "two arguments: usage, exit 2" 2 node "$S" a b
has "usage line" "Usage: node scripts/check-structure.mjs"
expect "missing folder: exit 2" 2 node "$S" "$TMP/nope"

# Counted lines: a tricky file of exactly 300 code lines, and copies one line over.
P="$TMP/size"
mkdir -p "$P/src/lib" "$P/src/app/api/projects/list" "$P/e2e"
node - "$P" <<'NODE'
const { writeFileSync } = require("node:fs");
const dir = process.argv[2];
const tricky = [
  'const url = "http://example.com"; // a comment after code',
  "/* a block comment",
  "   on two lines */",
  "const re = /\\/\\/ not a comment/;",
  "const t = `first line",
  "// inside a template: code, not a comment",
  '${"x"} end`;',
  "",
  "   // an indented comment",
  "const s = 'it\\'s /* not a comment */';",
];
const codeIn = 6;
const fill = (from, n) => Array.from({ length: n }, (_, i) => `export const v${from + i} = ${i};`);
const file = (code, extra = []) => [...tricky, ...fill(0, code - codeIn), ...extra].join("\n") + "\n";
writeFileSync(`${dir}/src/lib/exact.ts`, file(300, ["", "// trailing comment", "/* and another */"]));
writeFileSync(`${dir}/src/lib/big.ts`, file(301));
writeFileSync(`${dir}/src/lib/fine.test.ts`, file(400));
writeFileSync(`${dir}/src/lib/big.test.ts`, file(401));
writeFileSync(`${dir}/e2e/flow.spec.ts`, file(400));
writeFileSync(`${dir}/src/app/api/projects/list/route.ts`, `import { proxy } from "x";\nexport const GET = proxy(() => "/projects");\n` + fill(0, 149).join("\n") + "\n");
NODE
expect "oversized files fail" 1 node "$S" "$P"
lacks "300 counted lines pass (comments, strings, regex, template)" "src/lib/exact.ts"
has "301 counted lines fail" "src/lib/big.ts"
has "the message gives the count and the limit" "301 counted lines, the limit for a source file is 300"
lacks "a test file of 400 passes" "src/lib/fine.test.ts"
has "a test file of 401 fails" "401 counted lines, the limit for a test file is 400"
lacks "an e2e file uses the test limit" "e2e/flow.spec.ts"
has "a route file of 151 fails" "151 counted lines, the limit for a route file is 150"

# sizeExceptions: a tolerated file is a note, a stale entry asks to be removed.
mkdir -p "$TMP/scripts"
sed 's#  sizeExceptions: {},#  sizeExceptions: { "src/lib/big.ts": "split planned", "src/lib/big.test.ts": "split planned", "src/app/api/projects/list/route.ts": "x", "src/lib/gone.ts": "old" },#' \
  "$S" >"$TMP/scripts/check-structure.mjs"
expect "tolerated files pass" 0 node "$TMP/scripts/check-structure.mjs" "$P"
has "tolerated file is reported" "tolerated: src/lib/big.ts has 301 counted lines (limit 300): split planned"
has "stale exception is reported" "sizeExceptions lists src/lib/gone.ts"

# Generated primitives are exempt from the size limits; JSX text holding "/*" is code, not a comment.
G="$TMP/generated"
mkdir -p "$G/src/components/ui" "$G/src/components/projects" "$G/src/app/projects"
node - "$G" <<'NODE'
const { writeFileSync } = require("node:fs");
const dir = process.argv[2];
const fill = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
writeFileSync(`${dir}/src/components/ui/sidebar.tsx`, fill(700));
writeFileSync(`${dir}/src/components/projects/big.tsx`, fill(301));
const card = ["export function Card() {", "  return (", "    <div>", "      <p>Upload files that match src/* here</p>"];
for (let i = 0; i < 300; i += 1) card.push(`      <span>${i}</span>`);
card.push("      <p>end */</p>", "    </div>", "  );", "}");
writeFileSync(`${dir}/src/components/projects/card.tsx`, card.join("\n") + "\n");
NODE
expect "generated primitives: only the app's own files fail" 1 node "$S" "$G"
lacks "a generated primitive in src/components/ui/ is exempt" "src/components/ui/sidebar.tsx"
has "an app file of the same size still fails" "src/components/projects/big.tsx"
has 'JSX text with "src/*" is counted, as ESLint counts it' "308 counted lines, the limit for a source file is 300"

echo "== check-i18n"
I="$SCRIPTS/check-i18n.mjs"
expect "matching catalogs pass" 0 node "$I" "$FIX/i18n/good"
has "pass line with counts" "i18n check passed: 2 locale(s), 2 file(s), 7 key(s) each."
expect "drifting catalogs fail" 1 node "$I" "$FIX/i18n/bad"
has "declared locale without a folder" 'the app declares "de" but messages/de/ does not exist'
has "folder that is not declared" 'messages/es/ exists but the app does not declare "es"'
has "missing key" 'fr/common.json: missing key "nested.b"'
has "extra key" 'fr/common.json: extra key "extra"'
has "value kind" 'fr/common.json: "count" is a number, en has a string'
has "placeholder drift" 'fr/common.json: "greeting" uses {nom}, en uses {name}'
has "curly apostrophe" "fr/common.json: 1 string(s) use a curly apostrophe"
has "missing file" "messages/fr/only-en.json is missing"
has "file with no counterpart" "messages/fr/only-fr.json has no counterpart in en/"
has "invalid JSON" "messages/fr/broken.json is not valid JSON"
lacks "the straight apostrophe is fine" 'en/common.json: 1 string(s) use a curly'
expect "ICU and numbered placeholders: drift fails" 1 node "$I" "$FIX/i18n/icu"
has "numbered placeholder drift" 'fr/common.json: "page" uses {0}, en uses {0, 1}'
has "a placeholder inside a plural branch" 'fr/common.json: "cart" uses {count}, en uses {count, name}'
has "the left curly apostrophe (‘) too" "fr/common.json: 1 string(s) use a curly apostrophe"
lacks "select branch bodies are text, not placeholders" '"who" uses'
lacks "the same numbered placeholder passes" '"pageSame" uses'
mkdir -p "$TMP/noconfig"
cp -R "$FIX/i18n/good/messages" "$TMP/noconfig/messages"
expect "no locale config: folders compared" 0 node "$I" "$TMP/noconfig"
has "no locale config: says so" "no src/lib/i18n/config.ts"
expect "no messages folder: skipped" 0 node "$I" "$TMP/empty"
has "no messages folder: says so" "i18n check skipped: messages/ does not exist yet."
expect "two arguments: usage, exit 2" 2 node "$I" a b

echo "== check-json-dupes"
J="$SCRIPTS/check-json-dupes.py"
expect "clean catalogs pass" 0 python3 -I "$J" "$FIX/json/good"
has "clean: counts" "0 problem(s) in 1 file(s)"
expect "duplicates and invalid JSON fail" 1 python3 -I "$J" "$FIX/json/bad"
has "duplicate at the top level, with lines" 'duplicate key "title" (lines 2, 7)'
has "duplicate in a nested object, with its path" 'duplicate key "page.title" (lines 4, 5)'
has "invalid JSON in a sub-folder (recursive)" "deep/nested.json: invalid JSON"
has "bad: counts" "3 problem(s) in 2 file(s)"
expect "NaN and Infinity are not JSON" 1 python3 -I "$J" "$FIX/json/constants"
has "names the constant" "numbers.json: invalid JSON: NaN is not JSON"
expect "a single file works" 0 python3 -I "$J" "$FIX/json/good/en/common.json"
expect "a missing path is skipped" 0 python3 -I "$J" "$TMP/nope"
has "missing path: says so" "does not exist yet, skipped"
expect "no argument: usage, exit 2" 2 python3 -I "$J"
has "usage line" "Usage: python3 scripts/check-json-dupes.py"

echo "== check-theme"
T="$SCRIPTS/check-theme.mjs"
expect "parity holds" 0 node "$T" "$FIX/theme/good.css"
has "counts literal tokens (aliases and url() excluded)" "theme check passed: 5 literal colour token(s)"
expect "a literal with no dark twin fails" 1 node "$T" "$FIX/theme/missing-dark.css"
has "names the missing token" "--canvas: a literal colour in :root with no .dark value"
has "a named colour counts, inside @layer too" "--link: a literal colour"
lacks "a token with a twin passes" "--surface:"
expect "a literal colour in @theme fails" 1 node "$T" "$FIX/theme/theme-literal.css"
has "names the @theme token" "--color-brand: #3366ff is a literal colour in @theme"
lacks "a var() export in @theme passes" "--color-surface"
mkdir -p "$TMP/app/src/app"
cp "$FIX/theme/missing-dark.css" "$TMP/app/src/app/globals.css"
expect "default path src/app/globals.css" 1 bash -c 'cd "$1" && node "$2"' _ "$TMP/app" "$T"
has "default path: checked" "--canvas"
expect "missing stylesheet: usage, exit 2" 2 node "$T" "$TMP/none.css"
expect "two arguments: usage, exit 2" 2 node "$T" a b
expect "a dark media query still needs every token" 1 node "$T" "$FIX/theme/starter-missing.css"
has "names the token the media query lacks" "--foreground: a literal colour in :root with no .dark value"
lacks "the media query defines the other one" "--background:"

echo "== day one: a fresh create-next-app project"
ST="$FIX/starter"
expect "check-structure passes" 0 node "$S" "$ST"
expect "check-i18n skips (no messages/)" 0 node "$I" "$ST"
expect "check-json-dupes skips (no messages/)" 0 bash -c 'cd "$1" && python3 -I "$2" messages' _ "$ST" "$J"
expect "check-theme passes: the starter's dark media query is its dark sheet" 0 bash -c 'cd "$1" && node "$2"' _ "$ST" "$T"
has "check-theme: both starter colours have a dark value" "theme check passed: 2 literal colour token(s)"

echo "== eslint-rules"
expect "exports, limits and patterns" 0 node "$HERE/eslint-rules.test.mjs" "$SCRIPTS/eslint-rules.mjs"
node "$HERE/eslint-lint.test.mjs" "$SCRIPTS/eslint-rules.mjs" >"$OUT" 2>&1
code=$?
if [ "$code" -eq 77 ]; then
  skip=$((skip + 1))
  printf '  skip real ESLint leg (no ESLint found; set ESLINT_DIR to run it)\n'
elif [ "$code" -eq 0 ]; then
  ok "real ESLint lints the samples as the rules say ($(grep -c '^  ok' "$OUT") samples)"
else
  bad "real ESLint leg"
fi

echo
echo "code tests: $pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ]
