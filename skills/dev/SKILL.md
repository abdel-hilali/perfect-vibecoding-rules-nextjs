---
name: dev
description: Starts, keeps up and recovers the project's dev server with a keeper beside a memory guard and a vitest memory guard, frees a port by PID, and keeps a live API read-only. Use when the site is down or "not running", a server needs starting or restarting, a port is taken (EADDRINUSE), the machine is short of memory, before a heavy job, or after a reboot, crash or power cut.
---

# Dev server: start, keep up, recover

## Rules first

1. **Start the dev server through the keeper**, detached, never in a terminal you will close.
   `scripts/tools/dev-keeper.sh` restarts it when it is down and memory allows.
2. **Stop a process by PID, never by name.** Find the PID (`scripts/tools/free-port.sh <port>`, or `ss -lptn` on
   Linux, `lsof -nP -iTCP:<port> -sTCP:LISTEN` on macOS), check its working directory (rule 4), then `kill <pid>`.
   Never `pkill -f`: the pattern is also in your own shell's command line, so it kills the shell that runs it. Never
   `pkill <name>`, `pkill -x` or `killall` either: a name also matches the editor's helpers and other projects'
   processes.
3. **`pgrep -f` matches its own shell too**, so a script looks "already running" when it is not. To find a
   process, list `ps -eo pid=,args=` and match the arguments in code.
4. **Read a process's working directory before you kill it**: `readlink /proc/<pid>/cwd` (Linux),
   `lsof -a -p <pid> -d cwd` (macOS). A name filter once killed the editor's own lint helper.
5. **The owner watches the dev port live.** A build, `next start` or an E2E run takes the port and the site goes
   down. Say it in the same message ("site down about N minutes, it comes back by itself") or ask first.
6. **The dev server may talk to a live API. Treat it as production data: read-only.** GET and sign-in only.
7. **Check free memory and other heavy processes before a heavy job.** Wait for memory, never push the machine over.

## Start or recover the site

```bash
setsid nohup scripts/tools/dev-keeper.sh      >/dev/null 2>&1 </dev/null &
setsid nohup scripts/tools/dev-guard.sh       >/dev/null 2>&1 </dev/null &
setsid nohup scripts/tools/vitest-memguard.sh >/dev/null 2>&1 </dev/null &
scripts/tools/dev-keeper.sh --status   # keeper running? port up? free memory?
```

macOS has no `setsid`: use `nohup <command> >/dev/null 2>&1 </dev/null & disown`.

| Tool | What it does |
|---|---|
| `dev-keeper.sh` | Every 10 s: if nothing listens on `DEV_PORT`, memory is above `KEEPER_MIN_FREE_MB` and the last start is older than `KEEPER_COOLDOWN_S`, starts `DEV_CMD` in `APP_DIR`, detached. The cooldown stops a double start while the first server still boots. |
| `dev-guard.sh` | Stops the dev server when free memory falls under `GUARD_MIN_FREE_MB`. The keeper brings it back later. |
| `vitest-memguard.sh` | Stops the biggest vitest run of this app when free memory falls under `MEMGUARD_MIN_FREE_MB`. |
| `free-port.sh <port> [--force]` | Prints the owner (PID, command, cwd). Stops it only when its cwd is inside `APP_DIR`, or with `--force`. |

- Each loop refuses a second copy of itself. `--stop` ends it, `--once` runs one check. The guards touch only
  processes whose cwd is inside `APP_DIR`: another project's server or tests are left alone.
- Logs live in `runs/dev/`: `keeper.log`, `dev-server.log`, `guard.log`, `memguard.log`. Read `dev-server.log`
  first when the site will not come up.
- Set the parameters once in `scripts/tools/tools.env` (`DEV_PORT`, `DEV_CMD`, `APP_DIR`, `RUNS_DIR`, the memory
  floors). A variable set in the environment wins. The full table is in the tools playbook
  (`/perfect-vibecoding-rules-nextjs:tools`, or `docs/playbooks/tools/SKILL.md`).
- Point the app at one backend with one line in `.env`: the real API, or the local fixture API (`FIXTURE_PORT`).

## Take the port for a job, then give it back

1. Tell the owner the site goes down, and for how long.
2. `scripts/tools/dev-keeper.sh --stop`, else the keeper restarts the server under your build.
3. `scripts/tools/free-port.sh <DEV_PORT>` (the port set in `tools.env`).
4. Run the job (the gate playbook: `/perfect-vibecoding-rules-nextjs:gate`, or `docs/playbooks/gate/SKILL.md`).
5. Start the keeper again and check `--status`.

If the owner asks for the site in the middle of a job: stop the job first, then bring the site back.
"Stop everything" stops the site and all three loops: `dev-keeper.sh --stop`, `dev-guard.sh --stop`,
`vitest-memguard.sh --stop`, then `free-port.sh <DEV_PORT>`.

## Free a port

`free-port.sh` finds the owner with `ss` (Linux) or `lsof` (macOS), prints it, then sends a normal stop and
waits up to 10 seconds. With `--force` it may also stop a process outside the app, and send KILL if the stop is
ignored. Exit 0: the port is free. Exit 1: still held, left alone, or it cannot be checked (neither `ss` nor
`lsof` is installed: the keeper then starts nothing either). Before `--force`, read the cwd it printed. A process
of another user does not show at all: ask the owner.

## Before a heavy job

A type check of the whole project, the unit suite, a build, E2E or a fan-out of agents can each take gigabytes.

- Look first: `free -m` (Linux) or `vm_stat` (macOS), and the biggest processes:
  `ps -eo pid=,rss=,args= | sort -k2 -nr | head`. Another project's dev server or test run may share the machine.
- Run one heavy job at a time. The queued wrappers wait for memory and for each other:
  `scripts/tools/q-tsc.sh`, `q-vitest.sh <test files>`, `q-eslint.sh <files>`.
- When the owner says stop, stop at once.

## After a reboot, crash or power cut

- A reboot stops every detached job: the keeper, the guards, any background run. Start them again.
- Run `git status` and read the file dates and the reports in `runs/` before you assume work was lost. An agent
  cut mid-way keeps its file edits. Anything kept only in `/tmp` is gone.

## A live API is production data

- Read-only: GET and sign-in. Never a seed, migration, write, token rotation, export or delete against it, from
  a script, a test or a click in the browser.
- Prove every write on the fixture API. The real-backend E2E leg runs read-only specs only.
- Sign-in throttles are shared with real users: sign in rarely, from one browser engine.
- Never seed or migrate a shared database, not even to restore demo accounts. Ask the backend team, through the owner.

## Traps

- A shell that exports `NODE_ENV=production` breaks the dev server and the unit tests in odd ways. Check
  `echo $NODE_ENV` before you debug the code.
- zsh passes an unquoted `$VAR` holding several words as one argument, and an unmatched glob aborts the
  whole command. Quote globs: `--include='*.ts'`.

In Claude Code: the plugin's Bash hook blocks `pkill -f`. When a command takes the dev port (a build, a start, an
E2E run, `free-port.sh`), it shows the owner a one-line warning as the command starts and gives you a note with its
result (too late for that job: announce it first, rule 5); then tell the owner and restart the keeper. A command
that only names the port (curl, ss, lsof) gets the note alone. It never blocks for the port. The tools run only from
the project's own copy in `scripts/tools/`, which `/perfect-vibecoding-rules-nextjs:new-project` puts there: run
from `${CLAUDE_PLUGIN_ROOT}`, they would take the plugin folder for the app. Bash calls sent together share one
working directory, so use absolute paths or `( cd /abs/path && ... )`.
