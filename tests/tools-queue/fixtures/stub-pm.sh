#!/usr/bin/env bash
# Stands in for "pnpm exec" in the tests: prints what it was asked to run and where, then exits with STUB_EXIT.
echo "stub-pm: $*"
echo "stub-cwd: $(pwd)"
n=${STUB_LINES:-0}
i=1
while [ "$i" -le "$n" ]; do
  echo "stub line $i"
  i=$((i + 1))
done
exit "${STUB_EXIT:-0}"
