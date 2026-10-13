---
name: tools
description: Explains the shell tools in scripts/tools/ and how to set them up in tools.env. Queued type check, lint and test wrappers, a waiter that wakes on finished agents, an ownership sweep, a dev-server keeper and memory guard, a vitest memory guard and a safe port freer. Use when running tsc, eslint or vitest while other agents work, waiting on a wave, sweeping what a wave changed, keeping the dev server up, freeing a port, or installing and configuring the tools.
---

# The project tools (`scripts/tools/`)

Small bash and Python tools for one shared machine: several agents, one dev server, limited memory. Each bash tool
reads its parameters from `scripts/tools/tools.env` through `scripts/tools/lib.sh`. `sweep-owners.py` reads only
`APP_DIR`, the same way: from the environment, else from `tools.env`.

## Rules first

- While other agents work, never call `tsc`, `eslint` or `vitest` directly. Use the `q-*` wrappers: one heavy
  check runs at a time, the others wait in line. A wait of minutes is normal.
- Test FILES only. `q-vitest.sh` refuses a folder, an option or a file that is not a test.
- Stop a process by PID, never by name. `free-port.sh <port>` does it for a port. By hand: find the PID (`ss -lptn`
  on Linux, `lsof -nP -iTCP:<port> -sTCP:LISTEN` on macOS), check its working directory (`/proc/<pid>/cwd`; on
  macOS `lsof -a -d cwd -p <pid>`), then `kill <pid>`. Never `pkill -f` or `pgrep -f`: the pattern also matches the
  shell that runs it. Never `pkill <name>`, `pkill -x` or `killall`: a name match once stopped an editor's own helper.
- Start the long-lived tools (keeper, guards) detached: `setsid nohup <tool> >/dev/null 2>&1 </dev/null &` (macOS
  has no `setsid`: `nohup <tool> >/dev/null 2>&1 </dev/null & disown`). They then outlive the session. A reboot
  stops them: start them again.
- Run the tools from the app root. The `q-*` wrappers read relative file paths from `APP_DIR`, wherever you are.

## The tools

| Tool | What it does | When | Arguments | Parameters |
|---|---|---|---|---|
| `q-tsc.sh` | Type-checks the whole project in the queue; prints the tail and `tsc exit: N` | Once at the end of a package; after a merge | none | `TSC_MIN_FREE_MB` |
| `q-eslint.sh` | `eslint --max-warnings=0` on the files given, in the queue; prints `eslint exit: N` | On the files you changed | `<file>...` (no folder, no option) | `VITEST_MIN_FREE_MB` |
| `q-vitest.sh` | `vitest run <files> --maxWorkers=2` in the queue; prints `vitest exit: N` | On the tests you wrote, or whose subject you changed | `<test file>...` (`*.test.*`, `*.spec.*`) | `VITEST_MIN_FREE_MB` |
| `wait-milestone.sh` | Waits for the next finished agent in a journal, or the timer; then prints agents, changed paths, report sizes, free memory, dev port up or down | In the background while a wave runs, so you update the owner at least every 20 minutes | `<journal.jsonl> [seconds=1200] [report files...]` | `DEV_PORT` |
| `sweep-owners.py` | Read-only. Every path git sees changed must be claimed by exactly one agent's result; lists unclaimed paths, double claims, paths touched outside a list. Exit 1 when something is wrong | After a wave's finish pass, before the review; pass the journals of every run since the last commit | `[--repo DIR] <journal.jsonl>...` | `APP_DIR` when no `--repo` (the environment, else `tools.env`, like the bash tools) |
| `dev-keeper.sh` | Keeps the dev server up: starts `DEV_CMD`, detached, when the port is down and memory allows; a cooldown blocks double starts; logs under `RUNS_DIR/dev/` | Start of a day, after a reboot, after a build or E2E took the port | `[--once \| --stop \| --status]` | `DEV_CMD`, `KEEPER_MIN_FREE_MB`, `KEEPER_COOLDOWN_S` |
| `dev-guard.sh` | Stops this app's dev server when free memory falls under a floor; the keeper restarts it later | Beside the keeper, on a machine short of memory | `[--once \| --stop]` | `GUARD_MIN_FREE_MB` |
| `vitest-memguard.sh` | Stops this app's biggest vitest run when free memory falls under a floor | While builders or test runs are active | `[--once \| --stop \| --list]` | `MEMGUARD_MIN_FREE_MB` |
| `free-port.sh` | Prints the port's owner (PID, command, working folder); stops it only when that folder is inside `APP_DIR`, or with `--force`. Exit 0 free, 1 still held or cannot be checked (no `ss` or `lsof`) | A port is taken | `<port> [--force]` | `APP_DIR` |
| `lib.sh` | Shared helpers: `mem_free_mb`, `wait_for_memory`, `port_pid`, `with_heavy_lock` | Sourced by every tool; never run it | none | all |

Every tool also uses `APP_DIR`, `PM_EXEC`, `MEM_WAIT_ROUNDS`, `HEAVY_LOCK`, `DEV_PORT` and `RUNS_DIR` where they
apply. Two optional settings work for one call: `TAIL_LINES=N` (the `q-*` wrappers print the last N lines) and
`WAIT_POLL_S=N` (`wait-milestone.sh` checks every N seconds, default 20).

Examples:

```bash
scripts/tools/q-tsc.sh
scripts/tools/q-eslint.sh src/lib/apis/invoices/actions.ts src/components/invoices/invoice-table.tsx
scripts/tools/q-vitest.sh src/lib/apis/invoices/actions.test.ts
scripts/tools/wait-milestone.sh runs/<topic>/results.jsonl 1200 runs/<topic>/reports/A1.md
python3 -I scripts/tools/sweep-owners.py runs/<topic>/results.jsonl
scripts/tools/free-port.sh 3000
```

## Install and configure

1. **Copy.** The `new-project` playbook, or `node <kit>/install.mjs <project-dir>` (the installer at the kit's
   root), copies the kit's `templates/scripts/tools/` into the project's `scripts/tools/` and keeps their execute
   bits. By hand: copy the folder, then `chmod +x scripts/tools/*.sh scripts/tools/*.py`.
2. **Set the parameters once** in `scripts/tools/tools.env`. Each line only sets a default: a variable set in the
   environment wins, for one call (`DEV_PORT=3001 scripts/tools/dev-keeper.sh --status`).

   | Parameter | Default | Meaning |
   |---|---|---|
   | `APP_DIR` | the folder two levels above `scripts/tools/` | the Next.js app |
   | `DEV_PORT`, `DEV_HOST` | `3000`, `localhost` | where the dev server listens |
   | `DEV_CMD` | `$PM_EXEC next dev -p $DEV_PORT -H $DEV_HOST` | how the keeper starts it |
   | `FIXTURE_PORT` | empty | port of the local mock API for E2E, if any |
   | `PM_EXEC` | `pnpm exec` | `npx` for npm, `yarn` for yarn, `bunx` for bun |
   | `RUNS_DIR` | `$APP_DIR/runs` | logs, reports, backups |
   | `HEAVY_LOCK` | a file in the runtime folder, named after the app | the queue's lock; give two apps the same one to share a queue |
   | `TSC_MIN_FREE_MB`, `VITEST_MIN_FREE_MB` | `2600`, `2200` | free memory a queued check waits for |
   | `MEM_WAIT_ROUNDS` | `40` | rounds of 15 s a check waits for memory before it runs anyway |
   | `KEEPER_MIN_FREE_MB`, `KEEPER_COOLDOWN_S` | `2500`, `150` | the keeper starts only above this memory, and not twice within this time |
   | `GUARD_MIN_FREE_MB`, `MEMGUARD_MIN_FREE_MB` | `700`, `1500` | the floors of the two guards |

3. **What they need:** bash, git, python3 (for `sweep-owners.py` and the agent list of `wait-milestone.sh`),
   `flock` for the queue (Linux has it; on macOS install it, for example `brew install flock`, or the wrappers warn
   and run unqueued), and `ss` (Linux) or `lsof` (macOS) to find a port's owner: without either, the port tools
   say the port cannot be checked and stop or start nothing. They run on Linux and macOS; on Windows, only inside
   WSL (Git Bash lacks `ss`, `lsof` and `ps -o`).
4. **Check:** `scripts/tools/q-tsc.sh` ends with `tsc exit: 0`; `scripts/tools/dev-keeper.sh --status` names the
   port and whether it is up.

In Claude Code: with the plugin, the tools ship at `${CLAUDE_PLUGIN_ROOT}/templates/scripts/tools/`, and
`/perfect-vibecoding-rules-nextjs:new-project` copies them into the project. Run `wait-milestone.sh` with the Bash
tool's background option: its exit wakes you. A workflow run's journal is the `journal.jsonl` in the session's
`subagents/workflows/<run>/` folder under `~/.claude/projects/`. The plugin's Bash hook blocks `pkill -f`. When a
command takes `DEV_PORT` (a build, a start, an E2E run, `free-port.sh`), the hook shows the owner a one-line warning
as the command starts and gives you a note with its result: tell the owner, then restart the keeper. A command that
only names the port (curl, ss, lsof) gets the note alone. It never blocks for the port. It reads the port from
`scripts/tools/tools.env`.
