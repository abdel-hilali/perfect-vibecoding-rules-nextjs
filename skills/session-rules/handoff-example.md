# A good §8 handoff block

Write one like this at every boundary, on top of the older blocks. Each line answers a question the next session
would otherwise have to dig for. The names, numbers and dates below are made up.

```markdown
**State (2031-03-04 17:42, from `date`): wave 2 landed. This session ends here. READ THIS FIRST.**
- **State:** wave 2 (invoices list, invoice detail, members page) is built and uncommitted on `main`.
  `main` = `origin/main` = `4f2c9e1`, which is the live site. 38 changed paths, each claimed by one package.
  Targeted checks: `tsc` 0 errors at 17:31; i18n and structure checks clean.
  Backup of the uncommitted tree: `runs/wave-2/backups/landed-0304/`.
- **Runs or not:** nothing runs. Site, keeper and guards stopped at 17:40, on the owner's word.
- **Not run, on purpose:** no E2E and no full suite. The gate runs once, before the push.
- **Open for the owner:**
  1. The members page shows e-mail addresses to every role. Keep it, or managers only?
     **Recommended: managers only.**
  2. Do not push `main` before the gate: a push deploys. To save the work without a deploy: a push carries
     commits only. Commit on a side branch first, new files included, then `git push origin HEAD:wip-wave-2`;
     it does not deploy when only `main` deploys. Until then the only copy is the backup above.
- **Known and left on purpose:** the invoice PDF link opens in the same tab (wave 3 fixes it).
- **NEXT, in order:**
  1. The owner's answer to question 1: a one-line change in the access rules.
  2. One review round and a fixer over wave 2 (about 5 M tokens).
  3. A NEW session for the full gate. Then the owner pushes.
- **Paste-ready prompt for the next session:** *"Continue the project. Read docs/PROGRESS.md §8 first (the
  2031-03-04 17:42 block), then the 2031-03-04 entries of §7. My answer to question 1: ..."*
```

## Why it works

- The time comes from `date`, and "this session ends here" tells the reader it is the last word.
- It says where the code is: branch, commit, pushed or not, live or not, and where the backup is.
- It says what runs, or "nothing runs".
- It says what was **not** run, so nobody reads "done" as "tested".
- Each question carries the recommendation, marked.
- NEXT is in order, with costs, and says which step needs a new session.
- The prompt names the exact block and log entries to read.

## Gaps that cost the next session an hour

- "Tests pass", with no numbers and no time.
- Uncommitted work and no backup path.
- "Continue where we left off" as the prompt.
- A time written from memory.
- A State block that contradicts the one under it, with no "superseded" mark.
