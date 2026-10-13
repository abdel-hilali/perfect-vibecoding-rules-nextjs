# {{PROJECT_NAME}}

{{PURPOSE}}

These are the always-on rules for every AI coding agent in this project, whatever the tool. Read this file at the
start of every session. "The owner" is the person who directs the work. Code detail lives in `docs/RULES.md`; how-tos
live in the playbooks (table at the end). Commands use pnpm; npm, yarn and bun work the same.

## Start of every session

1. Read `docs/PROGRESS.md` §8 Handoff first (the newest State block is on top), then §0 to §4.
2. Find what moved since the last session, across the whole workspace, not only `git status` (it misses ignored
   files and other repos): `find . -newermt "<last session's time>" -type f -not -path '*/node_modules/*'
   -not -path '*/.git/*' -not -path '*/.next/*' -not -path './runs/*' -not -path './claude-chats/*'`. Edits you
   did not make (by hand, or by another AI tool) are yours to judge: read them, run their tests, then keep,
   correct or undo each one, with a backup first. Report which and why. Do not ask who made them.
3. Check what runs before you start anything: the dev server on port {{DEV_PORT}}, its keeper and guards, agents.

## Code: the rules that matter most

The full text is `docs/RULES.md` (R1 to R17). Working code for each rule: the `recipes` playbook.

1. **Size limits, in counted lines** (blank and comment-only lines do not count): a source file 300, a test file
   400, a component function 190, a function in `lib/`, `utils/` or `helpers/` 50, a hook 60, any other function 60,
   an API route file 150 (50 per function). Over a limit: split by responsibility, never squeeze lines.
2. **The API relay.** The browser calls only same-origin `/api/*`. One route file per public path, named by intent,
   ids last: `src/app/api/<domain>/<action-in-kebab>/[id]/[sub]/route.ts`, one line over the shared `proxy()`. The
   public path never mirrors the backend's. The backend URL is server-only: never `NEXT_PUBLIC_`.
3. **Every read on the server**, in Server Components, through ONE server fetch module. Writes are Server Actions:
   validate with the schema, authorize, call the backend, revalidate. No GET with a side effect that a prefetch can
   reach: never a `<Link>` to `/api/*`; sign-out is a POST.
4. **Four guard layers.** The edge proxy judges only the path and the presence of a session cookie; the
   authenticated layout calls `requireAuth(locale)`; every gated `page.tsx` starts with
   `await requireAccess(locale, AREA, LEVEL)`; `<Gate>` only hides buttons, and every action and route checks
   again. One access predicate, one permission ladder.
5. **Typed errors.** The fetch layer throws an `ApiError` with the backend's `code`. Branch on `code`, never on
   `message`. Never a swallowed `null`. Never a stack trace, an upstream URL or a token to the client.
6. **Colours only from theme tokens.** No `dark:` variant, no raw palette colour (`bg-white`, `text-zinc-600`). A new
   colour is a token in `:root` AND `.dark`. A theme-dependent value branches on `resolvedTheme`, never `theme`.
   Generated primitives in `src/components/ui/` are exempt from the theme rules and the size limits.
7. **No literal user-facing text** in components. Every locale's catalog changes together, by small targeted edits,
   never a whole-file rewrite. The straight apostrophe (') only.
8. **Structure.** Components mirror routes; file names are kebab-case; each domain folder, `src/lib/apis/<domain>/`,
   holds exactly `types.ts`, `form-schemas.ts`, `server-apis.ts`, `apis.ts` and `actions.ts`. App Router only.
   Server Components by default, `"use client"` only at the leaves: never in `page.tsx` or `layout.tsx`. Images
   and links go through the project's wrappers.
9. **Tests.** Unit tests for helpers, hooks, access logic and actions; a regression test for every bug fix. Mock the
   network boundary, not internals.
10. **Comments say why**, in the code's own terms. Never cite a ticket, a decision id, a report, an agent or a job.
11. **TypeScript, React and performance** (R3, R9 and R14b).
    - The frontend never touches the database: every read and every write is an HTTP call to the backend.
    - No `any`. No `@ts-ignore` or `@ts-expect-error` without a one-line reason.
    - Keys come from stable ids, never the array index.
    - Heavy or below-the-fold client code loads with `next/dynamic`.
    - No request waterfalls: start independent reads together (`Promise.all`).
    - A slow read streams behind `<Suspense>` or a `loading.tsx`: it never blocks the whole route.
    - `next/image`'s `priority` is deprecated in Next.js 16: put `preload` on the page's largest image.

A change is done when its targeted checks pass (seconds each):

- the type check;
- `pnpm exec eslint --max-warnings=0 <the files you changed>` (size limits, theme bans, client pages);
- the tests of the touched files;
- the check scripts: `pnpm check:structure`, `pnpm check:i18n`, `pnpm check:json`, `pnpm check:theme`.

A batch is done when the ONE gate passes (verify, build, E2E), run once, right before the push, in a fresh session.

A check fails? Fix the code, not the check. A rule is wrong for this project? Say so to the owner, then change
`docs/RULES.md` and the check together, on purpose.

## Working with the owner

1. **Budget first.** Before you launch agents, ask the owner's budget: give the cost in tokens of each option, your
   recommendation first, then wait for the owner's word. Name the cheapest clean stopping point. Never let a stage
   start by itself across a decision.
2. **Build first, never go quiet.** Launch builders before long checks. Update the owner at each stage and at least
   every 20 minutes. Give time estimates as ranges; say so the moment one slips.
3. **Say where to look.** A UI change comes with a "where to look" table: the page, the role or account, what the
   owner sees, and what not to click (it would write real data). Plumbing comes with "nothing to see in the browser
   yet".
4. **Short questions.** One decision each, the recommendation first and marked. "Do the recommended" means take
   every recommended option. Read terse messages for intent. When the owner must run something, the code block
   holds only what they paste: one step at a time, real paths, no placeholder; say the expected output in prose.
5. **Outside edits are yours to judge** (see "Start of every session").
6. **The conception wins.** The product rules win over the backend contract and the prototype. Settle a conflict
   before you build: a short question with the readings and a recommendation, then amend the conception (a
   numbered decision) or file a backend ask. Never pick silently. What the conception does not name is built only
   on the owner's yes.
7. **One asks file per part.** The backend team gets one self-contained `docs/BACKEND-ASKS-<n>.md`, made from
   `docs/BACKEND-ASKS.md`, and nothing else. A sent part is never edited: corrections go in the next part.
8. **A live API may be production data.** Read-only: GET and sign-in. Never a seed, migration, write, key rotation
   or export against it. Prove every write on the fixture API (a local mock of the backend).
9. **Two tiers of tests.** Targeted checks while you work. ONE full gate (verify, build, E2E) right before a push,
   after the review and fix round, in a fresh session. No E2E or full suite between stages. A push may deploy: keep
   the tree deployable at every stop, and say what a push would put live before the owner stops.
10. **Never take the dev port silently.** A build, `next start` or an E2E run takes port {{DEV_PORT}}, and the
    owner's site goes down. Say "site down about N minutes, it comes back by itself" in the same message, or ask
    first. Restart the dev keeper after.

## Sessions and the record

- The record is `docs/PROGRESS.md`. Update it in place, the day a stage lands.
- At every stage boundary (a wave lands, a review round ends, before the full gate, after a push, the end of a
  day): write §8, confirm nothing runs, then say "This is a session boundary. The handoff is written. Open a new
  session." Mid-wave is not a boundary. The full gate never runs in the session that built the batch.
- Clock times in the record come from `date`, never from an estimate. The owner's words go in §7 verbatim.
- Run long processes detached (`setsid`, or `nohup` on macOS). Keep scripts, reports, logs and backups in
  `runs/<topic>/`, never only in `~/.claude` or `/tmp`. Each agent creates its report at the start and appends as
  it goes.
- "Stop everything": stop agents, the dev server and its guards at once; back up the uncommitted tree
  (`git diff HEAD --binary` + a tar of untracked files, into the project's `runs/<topic>/backups/` by its absolute
  path); write §8; nothing else.
- Chat transcripts can hold secrets: keep them in a folder that ignores itself in git; never commit or share it.
  Docker and some deploy tools ignore `.gitignore`: list `claude-chats/` and `runs/` in `.dockerignore` and in
  your deploy tool's ignore file.

## Processes, ports and memory

- Never `pkill -f` and never feed `pgrep -f` to a kill: the pattern is also in the command line of the shell that
  runs it, so the kill ends your own call. `pgrep -f` finds its own shell too.
- Kill by PID, never by name: never `pkill <name>`, `pkill -x` or `killall` (a name match once stopped an editor's
  own helper). Find the PID (`scripts/tools/free-port.sh <port>`, or `ss -lptn` /
  `lsof -nP -iTCP:<port> -sTCP:LISTEN`), check its working directory (`/proc/<pid>/cwd` on Linux,
  `lsof -a -d cwd -p <pid>` on macOS), then `kill <pid>`.
- To find a process by its arguments, list `ps -eo pid=,args=` in a script and match there, skipping your own PID.
- Check free memory and other heavy processes before a heavy job. Run one heavy job at a time.

## Several agents in one working tree

- While other agents work, never call `tsc`, `eslint` or `vitest` directly: use `scripts/tools/q-tsc.sh`,
  `q-eslint.sh <files>` and `q-vitest.sh <test files>`. They wait in line. Test FILES, never a folder or the suite.
- Each builder writes only the files its brief lists. Anything else goes in its report under "Needs from others":
  the file, the exact text, why. Never remove or narrow an export, a type member or a copy key that another file
  reads: add, do not change.
- While agents work, never `git checkout`, `switch`, `stash`, `restore`, `reset`, `clean`, `add`, `commit`, `mv`
  or `rm`, and never format the whole tree: each one destroys another agent's uncommitted work. Back up to an
  absolute path that is unique to your package.
- Builders never run build, dev, start, E2E, the whole suite, or anything on the network.
- A refused tool call: wait 30 seconds, retry once, then go on without it and say so in the report.
- Every builder follows `docs/BUILDER-RULES.md`.

## Playbooks

Open the one that fits the task, and read it whole before you start.

| When | Read |
| --- | --- |
| Writing or reviewing app code; "is this allowed?"; a lint or check fails | `docs/playbooks/code-rules/SKILL.md` |
| "How do we do X here": theme, translations, API relay, server fetch, guards, forms, filters, toasts, realtime, motion, media, env, SEO, E2E; a strange Next.js bug | `docs/playbooks/recipes/SKILL.md` |
| Add or change a page, a tab or an endpoint | `docs/playbooks/screen/SKILL.md` |
| Before a push, or asked to run tests, a build or E2E | `docs/playbooks/gate/SKILL.md` |
| Start, restart or recover the dev server, a port is taken, after a reboot | `docs/playbooks/dev/SKILL.md` |
| Running tsc, eslint or vitest while agents work, keeping the dev server up, freeing a port, configuring `scripts/tools` | `docs/playbooks/tools/SKILL.md` |
| Several agents or builders in one working tree | `docs/playbooks/multi-agent/SKILL.md` |
| A stage ends, "stop everything", "where were we", after a crash, saving chats | `docs/playbooks/session-rules/SKILL.md` |
| Planning work, reporting progress, asking the owner, writing to the backend team | `docs/playbooks/working-rules/SKILL.md` |
| Setting up or repairing this kit: package.json scripts, ESLint wiring | `docs/playbooks/new-project/SKILL.md` |
| Changing a colour, `globals.css`, the top bar or the sidebar | `.claude/skills/design-direction/SKILL.md` (the settled design direction) |

Without the plugin, a playbook that names `/perfect-vibecoding-rules-nextjs:<name>` means
`docs/playbooks/<name>/SKILL.md`, and `${CLAUDE_SKILL_DIR}/<file>` means the file beside that playbook.

Claude Code with the plugin `perfect-vibecoding-rules-nextjs` has these playbooks as skills and loads them by itself
(only `new-project` waits for the owner's command). In such a project `docs/playbooks/` may be absent.
