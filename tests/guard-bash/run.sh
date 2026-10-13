#!/usr/bin/env bash
# Tests hooks/guard-bash.mjs: pipes PreToolUse JSON into it and checks stdout and the exit code.
# Works from any directory. Writes only inside a temp folder, removed at the end.
# Exits 0 only when every case passes.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "guard-bash: node not found"
  exit 1
fi
node --check "$ROOT/hooks/guard-bash.mjs" || { echo "guard-bash: syntax error in the hook"; exit 1; }

node "$HERE/run-cases.mjs" "$TMP"
status=$?
exit "$status"
