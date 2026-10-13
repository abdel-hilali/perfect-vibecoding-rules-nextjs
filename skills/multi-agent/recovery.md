# Recover an interrupted wave

A crash, a power cut, a full disk or a "stop everything" mid-wave leaves files half edited, in a tree several
agents shared. Do not guess and do not relaunch blindly. Work in this order.

## 0. Stop and look

- Confirm nothing still runs: no agent, no queued check, no build. A builder still writing will undo your repair.
- Read what is on disk: each builder's report (they were created at the start, so even a stopped one says what it
  planned and what it did), the plan in `runs/<topic>/`, and the saved launch script.
- List what changed: `git status --short` and, for files git does not track or ignores, `find . -newermt
  "<launch time>" -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*'
  -not -path './runs/*' -not -path './claude-chats/*'`.
- Run the md5 sweep now, before you repair anything ([wave-plan.md](wave-plan.md) §5): later, your own repairs show
  up too. A builder that died reported no md5: read its report.

## 1. Snapshot first

Before you touch anything, keep a copy of the tree as it is. Use an absolute folder:

```bash
P=<project>   # the project folder, absolute: where AGENTS.md and runs/ sit
R="$(git -C "$P" rev-parse --show-toplevel)"; B="$P/runs/<topic>/backups/recovery-$(date +%Y%m%d-%H%M)"; mkdir -p "$B"
git -C "$R" diff HEAD --binary > "$B/tracked.diff"
git -C "$R" ls-files --others --exclude-standard -z | tar -C "$R" --null -T - -czf "$B/untracked.tgz"
```

With the snapshot, every later step can be undone. To restore, on the same commit, from the repo root (`$R`):
`git apply "$B/tracked.diff"` and `tar -xzf "$B/untracked.tgz"`.

## 2. Fix syntax errors first

While a syntax error exists, the type checker reports only syntax errors and hides every semantic one. So:

1. Run `scripts/tools/q-tsc.sh`. Fix every syntax error: a half-written function, an unclosed bracket, a cut JSX tag.
2. Parse every changed JSON file (`pnpm check:json` covers the message catalogs).
3. Run `q-tsc.sh` again. Only now do the real errors show.

## 3. Hunt "new line added, old line not removed"

An edit that stopped half way often added the new text and never removed the old. Look for:

- **Duplicate JSON keys.** They still parse: the last one wins, silently, so the type check and the i18n check stay
  green. `pnpm check:json` (`scripts/check-json-dupes.py`) finds them.
- **Keys at the wrong nesting level.** A key added one level too high or too low: the old lookup still works, the new
  one returns nothing.
- **Deletions that never happened.** An old function, import, route file or test the spec said to delete, still there.
- **Two versions of one thing.** An old and a new component, both imported somewhere.

Compare each half-done file with its spec item by item, not with a guess of what the builder meant.

## 4. Finish, review, fix

1. **Finish pass:** one agent owns every file the wave touched. For each item of each brief: verify it against the
   tree, finish what is missing, apply the "Needs from others".
2. **Ownership sweep**, after the finish pass, with the journal of every run since the last commit, the interrupted
   run and the finish pass included ([wave-plan.md](wave-plan.md) §5). A builder that died returned no result, so
   its files show as unclaimed: check them against its report.
3. **Adversarial review:** reviewers try to break each package against its spec: a missing case, a wrong key, a
   frozen interface changed.
4. **Fixes per package:** one fixer per package, the same ownership rules as the wave.
5. Before the next wave, check every frozen interface is still as the plan says.

Write what happened and what you did in the record (`docs/PROGRESS.md`): the time from `date`, what was lost, what
was recovered.
