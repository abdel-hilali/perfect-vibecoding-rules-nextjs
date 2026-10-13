---
name: gate
description: Runs the project's quality checks in two tiers - seconds-long targeted checks while working, and one full gate per batch right before a push - in a safe order (verify, build, fixture E2E, a read-only real-backend leg), with the dev-port warning, browser engines and Playwright traps built in. Use when about to push, when calling a screen or wave done, or when asked to run tests, lint, typecheck, build or E2E.
---

# The quality gate

## Rules first

1. **Two tiers.** A change is done when its targeted checks pass (typecheck, `eslint --max-warnings=0` on the
   changed files, the tests of the touched files, the check scripts): seconds long. A batch is done when the ONE
   gate passes (verify, build, E2E), run once, right before the push, in a fresh session, after the review and fix
   round. Never twice for the same batch.
2. **No E2E and no full suite between stages.** Batches in flight share ONE gate at the very end.
3. **Order: verify → build → fixture E2E → read-only real-backend leg.** Cheapest and safest first. If verify is
   red, nothing after it matters.
4. **Build and E2E take the dev port.** Warn the owner in the same message ("site down about N minutes, it
   comes back by itself") or ask first. Then follow the port steps of the dev playbook
   (`/perfect-vibecoding-rules-nextjs:dev`, or `docs/playbooks/dev/SKILL.md`).
5. **Report real numbers for every leg, and name each leg you skipped and why.** Never say "green" when only
   verify ran.
6. **The local gate may be the only gate.** A push may deploy at once, and CI may be off. Keep the tree
   deployable at every stop.

## Tier 1: targeted, while working

Run only what touches your change. Seconds, not minutes.

- Types: `scripts/tools/q-tsc.sh` (or `pnpm typecheck`).
- Lint the changed files: `scripts/tools/q-eslint.sh <files>` (`--max-warnings=0`).
- Tests you touched: `scripts/tools/q-vitest.sh <test files>`. Test files, never a folder or the whole suite.
- The check scripts when relevant: `pnpm check:i18n`, `check:json`, `check:theme`, `check:structure`.

The `q-*` wrappers queue heavy checks one at a time and wait for free memory. The examples use pnpm; npm, yarn
and bun work the same.

## Tier 2: the full gate, once per batch

The script names below (`test:e2e`, `test:e2e:real`) are examples: use your project's.

### 1. Verify (no port, run it freely)

`pnpm verify` = typecheck → lint → check:i18n → check:json → check:theme → check:structure → test. Add the
coverage floor on `lib` and one run in a non-UTC timezone (for example `TZ=Pacific/Auckland`) if the project
has them.

### 2. Build (takes the dev port: warn first)

`pnpm build`. Run the build leg BEFORE the E2E leg and let it finish. Never start a build while E2E runs or
right after you launch it: Playwright's web server builds into the same `.next` folder, and two builds there
break each other. If the E2E web server builds the app itself, a green E2E run covers this leg too.

### 3. Fixture E2E (takes the port: warn first)

The E2E suite against a production build and the local fixture API. Safe to repeat. Name the engines that can
run on this machine:

```bash
pnpm test:e2e --project=chromium --project=firefox
```

- **Engines.** WebKit needs system libraries that some Linux distributions lack; there every test fails with
  "Host system is missing dependencies". Find out once which engines launch here, write it in `docs/PROGRESS.md`, and
  name them on every run. Skip an engine by name and say so; CI on another system can cover it.
- **A run that ends suspiciously fast** often ran fewer engines than you think. Count the projects that executed.

### 4. Real-backend leg (read-only, targeted, spaced out)

Only the specs the fixture cannot cover (realtime, anything the fixture does not serve), on ONE engine:

```bash
E2E_BACKEND_URL=https://api.example.com pnpm test:e2e:real e2e/realtime.spec.ts --project=chromium
```

- Read-only: no spec on this leg writes. Every write is proven on the fixture.
- Sign-in throttles are shared with real users. A full run on several engines signs in hundreds of times and
  locks everyone out with 429 errors. Run this leg deliberately, never on every iteration.

## Reporting

Give one line per leg: unit tests passed/total, fixture E2E per engine, real leg specs and engine, build
yes/no. Example: "verify: 412/412 · build: ok · fixture E2E: chromium 96/96, firefox 96/96, webkit skipped
(cannot launch here) · real leg: not run (no backend change)".

Before the owner stops for the day, say what a push would put live. When work must not ship yet, say so before
they stop and offer to save it without a deploy. A push carries commits only. Commit on a side branch first, then
`git push origin HEAD:wip-<topic>`; it does not deploy when only `main` deploys.

## Before you predict a failed deploy

A type error does not always break the deploy. Check whether the file is in the image first: `.dockerignore`
often leaves out `**/*.test.ts`, `**/*.spec.ts`, `e2e/` and `tests/`. Say "this breaks the deploy" only after
that check.

## Playwright traps that cost real time

- **Wait for the URL, not the network.** A client-side redirect can land 1 to 3 seconds later on a dev server.
  Use `await page.waitForURL(predicate)`, never `networkidle` plus a sleep.
- **Drain in-flight responses before clearing cookies.** A late response's `Set-Cookie` can bring a "cleared"
  cookie back. Call `await page.waitForLoadState("networkidle")`, then `context.clearCookies()`.
- **Single-use tokens burn once per engine.** An accept-invitation flow spends its token, and the matrix runs it
  once per project. Seed one token per engine (`invite-token-<project>`).
- **jsdom never fires `animationend`**, so React's `onAnimationEnd` never runs in a unit test. Attach a native
  listener (`addEventListener("animationend", ...)`) and dispatch the event in the test.

In Claude Code: when a command builds or starts the app, runs Playwright or frees the dev port, the plugin's Bash
hook shows the owner a one-line warning as the command starts and gives you a note with its result (too late for
that job: warn first, rule 4); then tell the owner and restart the keeper. It never blocks for the port. Run the
full gate in a new session that reads `docs/PROGRESS.md` first, never in the session that built the batch.
