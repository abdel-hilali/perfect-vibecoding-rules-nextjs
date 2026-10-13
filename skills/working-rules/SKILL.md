---
name: working-rules
description: Rules for working with the project owner. Ask the budget before launching agents, build first and report often, show visible changes with a where-to-look table, ask short questions with the recommendation first, judge outside edits, settle conflicts with the conception before building, send the backend one self-contained asks file, stay read-only on a live API, test in two tiers, never take the dev port silently. Use when planning or launching work, reporting progress, asking the owner something, finding edits you did not make, writing to the backend, or before a build, E2E run or kill.
---

# Working rules

How you work with the owner: their budget, time, attention, data and live site. These rules hold for
every task. Code rules live in `docs/RULES.md`.

## The ten rules, short

1. **Budget first.** Before you launch agents, ask the owner's budget: give the cost in tokens of each option, your recommendation first, then wait. Never let a stage start by itself across a decision.
2. **Build first, never go quiet.** Launch builders before long checks. Update the owner at each stage and at least every 20 minutes.
3. **Say where to look.** A UI change comes with a "where to look" table. Plumbing comes with "nothing to see in the browser yet".
4. **Short questions.** Recommendation first, marked. "Do the recommended" means take every recommended option.
5. **Outside edits are yours to judge.** Find what moved, judge it, keep / correct / undo with a backup first, report. Do not ask who made it.
6. **The conception wins.** Settle a conflict with the backend or the prototype before you build. Never pick silently.
7. **One asks file per part.** The backend gets one self-contained `docs/BACKEND-ASKS-<n>.md`, nothing else. A sent part is never edited.
8. **A live API may be production data.** Read-only: GET and sign-in. Prove every write on the fixture API.
9. **Two tiers of tests.** Targeted checks while you work. ONE full gate, right before a push.
10. **Never take the dev port silently.** Announce the downtime first. Never `pkill -f`. Kill by PID, never by name.

## 1. Budget before any launch

- The owner sees the usage meter; you do not. So before you start a launch, ask the owner's budget and say what each option costs, recommendation first, and wait for the owner's word.
- Give costs in tokens. Rough references from a real project: a builder package 0.4 to 0.6 M tokens, a finish pass about 0.5 M, a review round of 7 lanes with skeptics 5 to 6 M. Measure your own.
- Name the cheapest clean stopping point: the work is whole, the tree builds, nothing runs.
- When asked "how much is left?", give what is left before the next boundary, its rough cost and the cheapest clean stop. Then wait.
- Never let a stage start by itself across a decision. When a stop is likely (late in the day, after a big run), launch one stage per workflow, so a stop never cuts an agent mid-way.
- "Stop everything" means at once: agents, dev server, guards. Then back up the uncommitted tree, write the handoff, nothing else. No last check "to be sure". The steps: the session-rules playbook (`/perfect-vibecoding-rules-nextjs:session-rules`, or `docs/playbooks/session-rules/SKILL.md`).

## 2. Build first, keep the owner updated

- The owner judges progress by files changing and by the live site. A long check with nothing to show reads as nothing done.
- When builders can start, launch them first. A read-only check may run beside them if it touches no file a builder owns.
- Update the owner at each stage (first pass, finish, review, fixes, landed) and at least every 20 minutes. Arm a waiter that wakes you at the next milestone or after 20 minutes (`scripts/tools/wait-milestone.sh`).
- Give time estimates as ranges. Say so the moment one slips.
- Keep your own context lean while agents work: digest their results with a script, not by reading them whole.

## 3. Show visible UI changes

- The owner judges UI work by looking at the live site. If a still screen does not show it, for the owner it did not happen.
- With each UI change, give a "where to look" table: page, role or account, what the owner sees, and what not to click (anything that writes real data).
- Plumbing only (types, fixtures, copy keys): say "nothing to see in the browser yet".
- For a state the demo data cannot reach, take screenshots from the fixture run and say where they are.
- Visible is not loud: the project's settled design direction still bounds every change.

## 4. Questions

- Short, one decision each. The recommendation first, marked "(recommended)", each option with its cost.
- The owner may answer "do the recommended": take every recommended option.
- Read terse messages for intent. Reply plainly: short sentences, concrete next steps, no jargon walls.
- When the owner delegates ("do what is best"), decide, say what you chose, and go on.
- When the owner must run something, put ONLY what they paste in a code block: one step at a time, real paths, no placeholder left. Say the expected output in one sentence of prose. An owner who pastes a whole block once ran a sample output as a command.

## 5. Outside edits are yours to judge

The owner may edit the tree between sessions, by hand or with another AI tool.

- At the start of a session, find what moved since the last close with `find -newermt` across the whole workspace, not only `git status` (it misses ignored files, other repos and folders outside git).
- Judge each edit on its merits: read it, run its tests, prove a new test can fail (break the code, see red, restore it byte for byte).
- Keep, correct or undo it. Back it up first, to an absolute path under `runs/<topic>/backups/`.
- Report which and why, in the log of `docs/PROGRESS.md` and in your reply. Do not ask who made it: the owner does not track which tool made what, and the question costs a turn and decides nothing.
- Small corrections are yours. Rewriting the owner's intent needs their yes.

## 6. The conception wins

Three sources can disagree: the conception (the product rules), the backend contract (what the API serves) and the prototype (the layout).

- The conception wins unless the owner amends it.
- Settle a conflict before you build: a short question with the readings and a recommendation. Found after the build, it is baked into code and costs a rebuild.
- Then amend the conception (a numbered decision in the record) or file a backend ask, and report which. Never pick silently.
- When the owner leaves a conflict to you, judge each conflicting point on its merits, then amend the conception or file an ask, and say which.
- What the conception does not name is built only on the owner's yes.

## 7. One asks file per part for the backend

- The backend team gets ONE self-contained file per part: `docs/BACKEND-ASKS-<n>.md`, made from `docs/BACKEND-ASKS.md`. No zip, no extra message, no list of files.
- It carries everything: what to do first, on top; confirmations and corrections of the previous part; the full text of older asks they never received; the new asks.
- Keep it readable as plain text: it may travel through a chat app where Markdown does not render.
- Write it fast, from what is already verified (the record, the reports): one writer, minutes not an hour. No code re-scan, except for a new and doubtful claim. If the backend finds a problem, the next part follows up.
- A sent part is never edited again: the backend already has it, and an edit would never reach them. Corrections go in the next part. Ask numbers run across parts and are never reused.

## 8. A live API may be production data

- When the dev server talks to a live API, assume real users' data. Read-only: GET and sign-in only.
- Never run a seed, a migration, a write, a rotation (keys, share links) or an export against it. Never click a button that writes.
- Prove every write on the fixture API.
- Real-backend E2E: read-only specs, targeted, one browser engine, spaced out. Login throttles are shared with real users.

## 9. Tests: two tiers

- While working: targeted checks, seconds each. Typecheck, eslint on the changed files, vitest on the touched test files, the check scripts. While builders run, go through `scripts/tools/q-tsc.sh`, `q-eslint.sh`, `q-vitest.sh`.
- Once per batch: the full gate, right before a push, after the review/fix round, in a fresh session (the gate playbook: `/perfect-vibecoding-rules-nextjs:gate`, or `docs/playbooks/gate/SKILL.md`).
- No E2E, no full suite, no review round between stages. A verification stage is a test step too: while code is left to build, build it. Batches in flight share ONE gate.
- The owner pushes; you prepare the commit message and the gate. A push may deploy, and the local gate may be the only one. Keep the tree deployable at every stop: whole-project typecheck clean, every agent's check green.
- Before the owner stops, say what a push would put live. If something must not ship yet, say so and offer a side-branch push. A push carries commits only. Commit on a side branch first, then `git push origin HEAD:wip-<topic>`; it does not deploy when only `main` deploys.

## 10. Never take the dev port silently

- The owner watches the dev site live. A build, `next start` or any E2E run takes the dev port and takes the site down.
- Before such a job, say in the same message "site down about N minutes, it comes back by itself", or ask first. Restart the dev keeper after (`scripts/tools/dev-keeper.sh`; see the dev playbook: `/perfect-vibecoding-rules-nextjs:dev`, or `docs/playbooks/dev/SKILL.md`). If the owner asks for the site mid-job, stop the job and bring the site back.
- Builders never run build, start, E2E, the fixture API or anything on the network.
- Never `pkill -f`: the pattern is also in your own shell's command line, so it kills your own call (exit 144) and what follows never runs. `pgrep -f` matches its own shell too: a script that asks "am I already running?" always finds itself.
- Kill by PID, never by name. Find the PID: `scripts/tools/free-port.sh <port>`, or `ss -lptn` / `lsof -nP -iTCP:<port> -sTCP:LISTEN`; to find a process by its arguments, list `ps -eo pid=,args=` inside a script and match in code, skipping your own PID. Check its working directory (`/proc/<pid>/cwd` on Linux, `lsof -a -d cwd -p <pid>` on macOS), then `kill <pid>`. Never `pkill <name>`, never `pkill -x`, never `killall`: a name also matches other projects' servers and the editor's own helpers.

## Claude Code

In Claude Code: the plugin's shell hook (`hooks/guard-bash.mjs`, on the Bash and PowerShell tools) denies `pkill -f`, and any kill fed by `pgrep -f`, before they run. When a command can take the dev site down (a build, a start, an E2E run, `PORT=` the dev port, `free-port.sh` on it), the hook shows the owner a one-line warning as the command starts and gives you a note with its result: too late for that job, so announce it first. A command that only names the port (curl, ss, lsof) gets the note only. It never blocks for the port. The port is `DEV_PORT`, or the one in `scripts/tools/tools.env`. Arm the 20-minute waiter as a background Bash command. A workflow run belongs to its session: a new session relaunches what is missing from the saved script and the reports on disk. The message templates are at `${CLAUDE_SKILL_DIR}/examples.md`.

## Templates

Messages for each rule (budget, update, where to look, question, conflict, outside edits, port, end of day, a read-only API probe): [examples.md](examples.md).
