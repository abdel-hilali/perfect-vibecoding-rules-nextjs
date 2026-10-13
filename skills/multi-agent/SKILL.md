---
name: multi-agent
description: Runs several AI builder agents in one working tree without losing work. Covers disjoint file ownership, frozen interfaces, absolute backups, no destructive git, one queued heavy check at a time, reports written from the start, a finish pass, ownership and md5 sweeps, and recovery of an interrupted wave. Use when planning a wave, writing builder briefs, launching several agents that write code in parallel, checking what a wave changed, or when a wave stopped half way.
---

# Several builders in one working tree

Parallel builders share one uncommitted tree. There is no safety net: one wrong command destroys the others' work.
These rules keep a wave safe, cheap to check and easy to resume. Give every builder `docs/BUILDER-RULES.md`: it
holds the same rules, from the builder's side.

## The rules

1. **Disjoint ownership.** Each brief lists the exact files its builder may write. Two builders never own the same
   file. Anything else a builder needs goes in its report under "Needs from others": the file, the exact text, the
   item it serves.
2. **Interfaces land first, then freeze.** Shared types, exports, route paths and copy keys are written and checked
   before the builders that use them start, so nobody compiles against a half-written file. After that: add, never
   change. Never remove or narrow an export, a type member or a copy key that another file reads.
3. **No destructive git, no tree-wide format.** Never `git checkout`, `switch`, `stash`, `restore`, `reset`,
   `clean`, `add`, `commit`, `mv` or `rm`. Never format or auto-fix the whole tree. Each one rewrites files other
   agents are editing. Read-only git (`status`, `diff`, `log`, `show`, `grep`) is fine.
4. **Absolute, unique backup paths.** Each package backs up into its own absolute folder, for example
   `<project>/runs/<topic>/backups/<package>/`. A relative path resolves against the agent's current folder; one
   once landed in the wrong repository.
5. **One heavy check at a time.** While builders run, nobody calls `tsc`, `eslint` or `vitest` directly. Use
   `scripts/tools/q-tsc.sh`, `q-eslint.sh <files>` and `q-vitest.sh <test files>`: they wait in line on one lock
   and for free memory. Test FILES only, never a folder or the whole suite.
6. **Builders stay off shared resources.** No build, dev, start, E2E, whole suite, or anything on the network. The
   dev port is the owner's, and a live API may be production data.
7. **Reports on disk from the start.** Each builder creates its report at the START (title and a five-line plan)
   and appends as it goes. A stop then keeps what was done.
8. **A refused tool call:** wait 30 seconds, retry once, then go on without it and say so in the report.

## Plan a wave

1. Write the plan in `runs/<topic>/`: the ownership rules, the frozen interfaces table, and each package with its
   files (new and changed), what it builds and its tests. Use the form in [wave-plan.md](wave-plan.md).
2. Check that ownership is disjoint: each file appears in at most one list. Shared registration files (a barrel
   `index.ts`, a route list, a message catalog) get ONE owner per wave. A file several waves need is handed on in
   a fixed order, one owner at a time.
3. New interfaces land first: one builder (or a first wave) writes them, its check is green, then they freeze.
4. Each brief names: the package id, its files, its specs, the absolute report path, the absolute backup folder,
   the result keys below, and `docs/BUILDER-RULES.md`.
5. Launch the builders first. A read-only check may run beside them only if it touches no file a builder owns. Keep
   the launch script in `runs/<topic>/`.
6. While they run, keep `scripts/tools/wait-milestone.sh <journal.jsonl> 1200 <reports...>` running in the
   background. It returns on the next finished agent or after 20 minutes, with a short status. Update the owner at
   each return, then start it again.

## What every builder returns

A **report** at the path its brief gives: per item done, partial or skipped, and why · files changed, created and
deleted · deviations and why · **Needs from others** (file, exact text, item) · **E2E for later** (what a browser
must prove; builders do not write E2E unless they own it) · **Where the owner sees it** (page, role or account, what
the owner sees, what not to click because it writes real data) · each check with real numbers · the md5 of each
file it wrote.

A **structured result** with the same keys for every builder: `files_changed`, `files_created`, `files_deleted`,
`touched_outside_list` (each with a reason), `checks`, `needs_from_others`, `deviations`, `report`. The ownership
sweep reads the first four. The full shape is in `docs/BUILDER-RULES.md`, section 6.

## After the wave

1. **md5 sweep, first, the moment the wave lands.** Compare each file's md5 with the md5 its owner reported. A
   different sum means another agent wrote the file after its owner finished: read the diff and keep the right
   version. Run it before anyone else writes: after the finish pass, every file it edits shows up too.
2. **Finish pass.** Assume the wave is half applied. Verify each item of each brief against the tree as it is now,
   finish what is missing, and apply the "Needs from others". One agent, owning every file the wave touched, in
   its own run with its own journal: inside the builders' run, each file it edits again counts as a conflict.
3. **Ownership sweep.** `python3 -I scripts/tools/sweep-owners.py <journal.jsonl>...`, with the journal of EVERY
   run since the last commit (earlier waves, the finish pass): the tree still holds their work. Every changed
   path must be claimed by exactly one agent. Unclaimed means someone wrote outside its list, or a run's journal
   is missing; your own edits as orchestrator (the record) show as unclaimed too: name them. Two claims in one run
   is a conflict. Judge each "touched outside its list" on its merits. No journal? Keep the results in a file by
   hand, as [wave-plan.md](wave-plan.md) shows.
4. Then one review round, fixes per package, and the full gate once, right before a push (the `gate` playbook,
   `/perfect-vibecoding-rules-nextjs:gate` or `docs/playbooks/gate/SKILL.md`). No E2E or full suite between
   stages.

The commands for both sweeps are in [wave-plan.md](wave-plan.md).

## Recover an interrupted wave

A crash, a power cut or a stop mid-wave leaves files half edited. Work in this order:

1. **Snapshot first**, before you touch anything: `git diff HEAD --binary` and a tar of the untracked files, into
   `runs/<topic>/backups/`.
2. **Fix syntax errors first.** While one exists, the type checker reports only syntax errors and hides every
   semantic one.
3. **Hunt "new line added, old line not removed".** Duplicate JSON keys still parse (the last one wins silently;
   `pnpm check:json` finds them). Also keys at the wrong nesting level, and deletions that never happened.
4. **Then finish, review, fix.** The finish pass, an adversarial review, fixes per package. Check the frozen
   interfaces before the next wave.

Step by step, with commands: [recovery.md](recovery.md).

In Claude Code: builders are subagents or workflow agents. Give each the result keys above as its output schema. A
workflow run writes its events to a `journal.jsonl` in the session's `subagents/workflows/<run>/` folder under
`~/.claude/projects/`: that is the file `wait-milestone.sh` and `sweep-owners.py` read. Copy the workflow script into
`runs/<topic>/` right after launch: a new session cannot resume an old run, only relaunch it. Run the waiter with
the Bash tool's background option, so its exit wakes you. The plugin's Bash hook blocks `pkill -f`.
