---
name: session-rules
description: Keeps long AI-assisted work resumable across sessions, crashes and restarts. Covers when to end a session, the handoff on top of docs/PROGRESS.md, where scripts, reports and backups must live, what "stop everything" means, and saving every chat. Use when a stage or wave ends, before the full gate, after a push, at the end of a day, when the owner says "change session", "stop everything", "where were we", or a new session opens with "continue" and the handoff, after a power cut, or when chats or transcripts need saving.
---

# Session rules

The rules first. The details follow.

1. **Change session at every stage boundary.** Write the handoff (§8 of `docs/PROGRESS.md`), confirm nothing runs,
   then say it first, unasked: "This is a session boundary. The handoff is written. Open a new session."
   Mid-wave (agents still running) is not a boundary.
2. **The record is `docs/PROGRESS.md`.** Its §8 Handoff sits on top of the file, and a new session reads it first.
3. **Everything that must survive lives in the project**, under `runs/<topic>/`. Never only in `~/.claude` or `/tmp`.
4. **"Stop everything" means at once:** stop the agents, the dev server and its guards, back up the uncommitted
   tree, write §8. Nothing else.
5. **Save every chat:** the owner's words and every decision go in the §7 log, and the transcripts are copied into
   the project.

## 1. Session boundaries

A boundary is: a wave (a batch of agents launched together) lands, a review round ends, right before the full
gate, right after a push, the end of a day.

At a boundary, in this order:
1. Write the §8 handoff, complete: the state, what is open for the owner, NEXT in order, a paste-ready prompt.
2. Confirm nothing runs: agents, the dev server, its keeper and guards (`scripts/tools/dev-keeper.sh`,
   `dev-guard.sh`), background jobs. Name anything you leave running on purpose, and why.
3. Say it first, without being asked: "This is a session boundary. The handoff is written. Open a new session."

Why: a long session's context gets heavy and summarized. A fresh session that works from a written handoff is more
reliable, and writing the handoff forces the record to be complete.

- **Mid-wave is not a boundary.** If builders are running and the owner asks to switch, answer "not yet: when the
  wave lands, at about HH:MM". Switching now abandons the running agents.
- Nearing the context limit is not a reason to switch either: the session compacts and carries on. Keep §8 resumable
  at all times anyway, in case the owner closes the session.
- **The full gate never runs in the session that built the batch.** A fresh session reads the record and judges the
  work cold. See the gate playbook (`/perfect-vibecoding-rules-nextjs:gate`, or `docs/playbooks/gate/SKILL.md`).
- **A new session cannot resume an old session's workflow run or its agents.** Relaunch the missing stages from the
  script saved in `runs/<topic>/` and the reports on disk. Tell each relaunched agent: "half applied: verify each item
  against the tree, finish what is missing".

## 2. The record: `docs/PROGRESS.md`

It starts from the kit's template (the installer or the new-project skill puts it in place). Top to bottom:

- **§8 Handoff, on top.** The newest "State" block first: the state (built, committed, pushed, live, running), what
  is open for the owner, NEXT in order, and a paste-ready prompt for the next session. Older blocks stay below,
  marked "superseded by the block above".
- **§0 State** · **§1 The brief**, verbatim · **§1b The owner's decisions** · **§2 Rules** · **§3 Stages** ·
  **§4 Decisions for the owner** · **§5 / §6** as needed (screens, asks, risks, traps).
- **§7 Log**, dated, newest last: the owner's words verbatim, every decision with its reason, what was launched and
  what it cost, what landed, checks with real numbers.

Two rules for every entry:
- **Clock times come from `date`, never from an estimate.** The next session orders events by them, and guessed
  times drift by most of an hour.
- **Update the record in place, the day a stage lands.** Never let §8 lag behind the tree.

A good §8 block, in full: [handoff-example.md](handoff-example.md).

## 3. Survive restarts

Power cuts, reboots, a wiped home folder and killed sessions all happen. Plan for them.

- Run long processes detached, with output in a file: `setsid nohup <command> > runs/<topic>/<name>.log 2>&1 &`
  (macOS has no `setsid`: use `nohup ... &` then `disown`). A reboot still stops them: restart them after one.
- Keep scripts, workflow scripts, briefs, reports, logs and backups in `runs/<topic>/` inside the project.
  `~/.claude` and `/tmp` can vanish. `runs/` is ignored by git, so copy what matters elsewhere too.
- **Each agent creates its report at the START** (title and plan), then appends each finding as it goes.
  "Write the report before returning" is too late: an agent stopped mid-way leaves nothing behind.
- **Copy each workflow script into `runs/<topic>/` right after you launch it.**
- After a crash, read `git status`, the file dates and the reports before you assume work is lost. An agent cut
  mid-way keeps its file edits and loses only its final answer.

## 4. "Stop everything"

It means now, all of it, and nothing else:

1. Stop the agents, the dev server, its keeper and guards, all at once. Kill by PID, never by name: find the PID
   (`scripts/tools/free-port.sh <port>`, or `ss -lptn` / `lsof -nP -iTCP:<port> -sTCP:LISTEN`), check its working
   directory (`/proc/<pid>/cwd` on Linux, `lsof -a -d cwd -p <pid>` on macOS), then `kill <pid>`. Never `pkill -f`,
   `pkill <name>`, `pkill -x` or `killall`. Details: the dev playbook (`/perfect-vibecoding-rules-nextjs:dev`, or
   `docs/playbooks/dev/SKILL.md`).
2. Back up the uncommitted tree, with absolute paths: a relative one lands in whatever folder you are in, and
   misses the files above it. In a monorepo the project is the app's folder, not the repo root.
   ```bash
   P="<project>"   # the project folder, absolute: where AGENTS.md and runs/ sit
   R="$(git -C "$P" rev-parse --show-toplevel)"; B="$P/runs/<topic>/backups/stop-$(date +%Y%m%d-%H%M)"; mkdir -p "$B"
   git -C "$R" diff HEAD --binary > "$B/tracked.diff"
   git -C "$R" ls-files --others --exclude-standard -z | tar -C "$R" --null -T - -czf "$B/untracked.tgz"
   ```
3. Write the §8 handoff, with the backup path.

Do not run a last check "to be sure". Do not start anything new. To restore, on the same commit, from the repo
root (`$R`): `git apply "$B/tracked.diff"` and `tar -xzf "$B/untracked.tgz"`.

## 5. Save every chat

- **The record:** §7 keeps the owner's words verbatim and every decision. This works with any AI tool.
- **The transcripts:** keep a copy of each session's full chat inside the project, in a folder that git ignores.
  If your tool can export its chat history, export it there.
- **Privacy:** transcripts are plain text and can hold secrets (tokens, passwords, private data). Give the folder its
  own `.gitignore` holding `*`, so it ignores itself in git. Never commit it, never share it, never paste from it.
  Docker and some deploy tools ignore `.gitignore`: list `claude-chats/` (or your chats folder) and `runs/` in
  `.dockerignore` and in your deploy tool's ignore file.

In Claude Code: the plugin's save-chat hook does the copying, each time Claude finishes a reply, before each
compaction and at session end. It copies `<session-id>.jsonl` first, then the session's folder of subagent
transcripts and tool results, only the files that changed, into `claude-chats/` (mode 700, with a `.gitignore`
holding `*`), and logs one line per run in `claude-chats/copies.log`. Plugin options: `save_chats` (default on; set
it off to stop) and `chats_dir` (default `claude-chats`, relative to the project; an absolute path, `..`, `~` or a
variable such as `$HOME` falls back to the default). Change them in `/config`, or in `/plugin` > Installed >
Configure options. Claude Code deletes its own transcripts after `cleanupPeriodDays` (30 days by default), so set a
large value in `~/.claude/settings.json`: `{ "cleanupPeriodDays": 3650 }` (0 is not accepted). The example file is
`${CLAUDE_SKILL_DIR}/handoff-example.md`.
