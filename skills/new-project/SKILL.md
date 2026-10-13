---
name: new-project
description: Sets up this kit in a Next.js app. Copies AGENTS.md, CLAUDE.md, the docs templates, the check scripts and the tools without overwriting anything, fills the project name, date and dev port, adds the package.json scripts, wires the ESLint rules, and keeps runs/ and secrets out of git. Use when the owner says "new project", "set up the kit", "install the rules in this project", or starts an app that should follow these rules.
disable-model-invocation: true
argument-hint: "[dev-port]"
---

# Set up the kit in a project

## Rules first

1. **Never overwrite a file.** The installer skips every file that exists and lists it. The setup's own edits are
   small targeted additions, shown as a diff: the `package.json` scripts, the ESLint spread in `eslint.config.mjs`,
   the missing `.gitignore`, `.dockerignore` and `.gitattributes` lines, and the `@AGENTS.md` line at the top of a
   `CLAUDE.md` that was already there. Any other merge into an existing file (an `AGENTS.md` that was already
   there, a starter file to replace) needs the owner's yes.
2. **Ask once, up front, with defaults:** the project's purpose in one line, the dev port (3000), whether
   teammates use other AI tools (then the project keeps the playbooks), and their yes to those setup edits. A port
   given with the command wins.
3. **The app comes first.** The project root is the folder with `package.json`. No app yet? Create it before the
   kit: `create-next-app` wants an empty folder.
4. **The setup takes no port.** No build, no dev server, no E2E.
5. **The owner commits.** End with `git status` and a proposed commit message.

## 1. Check the ground

- Find the app's root: `package.json` beside `src/app/` (or `app/`). In a monorepo, the Next.js app's folder.
- No app yet: recommend `pnpm create next-app@latest <name>` with TypeScript, ESLint, Tailwind CSS, the App Router
  and the `src/` folder. Then continue inside the new folder.
- Tools: Node 18+, git, Python 3 (for `check:json` and `sweep-owners.py`), bash for `scripts/tools/` (macOS and
  Linux; on Windows, inside WSL: Git Bash lacks `ss`, `lsof` and `ps -o`). Say what is missing. Do not install
  system packages yourself.
- Read `git status` first, so the setup's changes stay easy to review apart from earlier work.

## 2. Copy the templates

Run the installer from the kit's folder (`<kit>`, a clone of the kit's repository). An earlier run left
`AGENTS.md` and `docs/RULES.md`? Run it anyway: it skips every file that exists and adds only what is new in the
kit; report what it created.

```bash
node <kit>/install.mjs <app-dir> --port <port>
```

- It copies `AGENTS.md`, `CLAUDE.md`, `docs/` (`RULES.md`, `PROGRESS.md`, `BACKEND-ASKS.md`, `BUILDER-RULES.md`),
  `scripts/` (four check scripts, `eslint-rules.mjs`, `scripts/tools/`), `.claude/skills/design-direction/SKILL.md`
  and the playbooks (`docs/playbooks/`). For a new or empty `runs/`, it writes `runs/.gitignore`, so `runs/` stays
  out of git. It writes `.dockerignore` and `.gitattributes` when they are missing (step 7).
- It fills the project name (the folder's name), today's date and the port, also in `scripts/tools/tools.env`.
  It keeps the execute bits of the tools and writes them with LF line endings. `--dry-run` shows the plan and
  writes nothing.
- `--no-playbooks` leaves out `docs/playbooks/`: use it only when everyone works in Claude Code with the plugin.

Read its output and report each skipped file and each warning. These need action:

- `AGENTS.md` was there already: offer to merge the kit's sections into it. Show the diff first.
- `CLAUDE.md` was there without an `@AGENTS.md` line: add that line at its top, or Claude Code never reads the
  rules (with a `CLAUDE.md` present, it reads that file instead of `AGENTS.md`).
- `.dockerignore` or `.gitattributes` was there and lacks lines: add the lines the warning names (step 7).

## 3. Fill what the installer cannot

- `{{PURPOSE}}` in `AGENTS.md` and `docs/PROGRESS.md`: the owner's one line.
- `scripts/tools/tools.env`: `PM_EXEC` for npm (`npx`), yarn (`yarn`) or bun (`bunx`); the installer names it when
  a lockfile tells. `FIXTURE_PORT` when a mock API exists. `APP_DIR` stays empty: the tools take the app as the
  folder two levels above them, in a monorepo too.
- `.claude/skills/design-direction/SKILL.md`: leave its prompts for the owner, or fill them from a design spec the
  owner points to. Never invent a direction.

## 4. package.json scripts

Add these and keep every existing script. A script with the same name and another command: ask first.

```json
{
  "typecheck": "tsc --noEmit",
  "check:structure": "node scripts/check-structure.mjs",
  "check:i18n": "node scripts/check-i18n.mjs",
  "check:json": "python3 scripts/check-json-dupes.py messages",
  "check:theme": "node scripts/check-theme.mjs",
  "verify": "pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm check:json && pnpm check:theme && pnpm check:structure && pnpm test"
}
```

- `lint` (`eslint`) and `test` (for example `vitest run`) are the project's own. No `test` script yet? Recommend
  vitest; it is a new dev dependency, so ask first. Until then `verify` stops at `test`: say so.
- Optional, once the unit suite exists: `test:coverage` and `test:tz` (a coverage floor, a non-UTC run), then
  `verify` ends with them in place of `test`: [setup-notes.md](setup-notes.md).
- With npm, yarn or bun, write `verify` with that runner. On Windows, `python3` may be `py`.

## 5. ESLint

In `eslint.config.mjs`, spread the kit's rules AFTER the framework's own config:

```js
import codeRules, { typeImportRules } from "./scripts/eslint-rules.mjs";
// in the exported array, after the Next.js entries:
//   ...codeRules, ...typeImportRules,
```

`codeRules` holds the size limits, the theme bans and the hygiene rules. `typeImportRules` needs the TypeScript
ESLint plugin, which the Next.js TypeScript config registers: spread it after that config. Add the named export
`wrapperRules` later, once `src/components/overrides/` holds the image and link wrappers. The full example and the
options: `checks.md` in the code-rules playbook.

## 6. The starter files

A fresh `create-next-app` ships a demo `src/app/page.tsx` that lint fails (`dark:` variants, palette classes),
and a `globals.css` that switches dark mode by a media query: `check:theme` accepts it, and a theme toggle needs
the class-based setup of the theme recipe. What to do with each: [setup-notes.md](setup-notes.md). Replacing a
starter file needs the owner's yes and a diff (rule 1).

## 7. Keep secrets and work files out of git and out of builds

- `.gitignore` holds `.env*` and, after it, `!.env.example`. Add whichever line is missing.
- `runs/` and the saved-chats folder ignore themselves: each holds a `.gitignore` with `*`. The installer warned
  that `runs/` already held files? Then add `runs/` to `.gitignore`.
- Docker and some deploy tools ignore `.gitignore`: list `claude-chats/` and `runs/` in `.dockerignore` (create it
  if missing), and in the ignore file of any deploy tool that uploads the folder.
- `.gitattributes` keeps the tools' LF line endings in a Windows clone. The lines: [setup-notes.md](setup-notes.md).
- Never commit `.env`, chat transcripts or `runs/`.

## 8. Check that it works

From the app's root, run `pnpm check:structure`, `pnpm check:i18n`, `pnpm check:json` and `pnpm check:theme`.
Each passes, or notes that its folder does not exist yet; `check:theme` reads `src/app/globals.css` (or
`app/globals.css`). Then run `pnpm exec eslint --max-warnings=0` on one source file, and
`scripts/tools/dev-keeper.sh --status`, which names the port. On a fresh app, lint fails on the demo page until
step 6 replaces it: report it, do not hide it. Report the real results, failures included.

## 9. Record and hand over

- `docs/PROGRESS.md` §7: a first entry, with the time from `date`: what the installer created and skipped, and
  what you changed by hand.
- Tell the owner what changed, what is left for them (the purpose line, the design direction, the commit), and
  how to work from now on: every AI tool reads `AGENTS.md` first.
- End with the boundary line: "This is a session boundary. Open a new session, so your AI tool starts with the
  new `AGENTS.md`."

In Claude Code: `<kit>` is `${CLAUDE_PLUGIN_ROOT}`, so run
`node "${CLAUDE_PLUGIN_ROOT}/install.mjs" "${CLAUDE_PROJECT_DIR}" --no-playbooks --port <port>` (or the app's
folder, in a monorepo). In a monorepo, tell the owner to install the plugin from the app's folder and start
Claude Code there: its `CLAUDE.md` (with `@AGENTS.md`) then loads at once, and the Bash hook finds
`scripts/tools/tools.env`. A session that must start at the repo root needs `{ "env": { "DEV_PORT": "<port>" } }`
in the repo's `.claude/settings.json`, or it gets no port warning. The plugin provides the skills, so the project
gets `AGENTS.md` and `CLAUDE.md` and no playbooks; drop `--no-playbooks` when teammates use other AI tools. The
plugin's hooks work as soon as it is enabled. Claude Code reads `CLAUDE.md` (and the `AGENTS.md` it imports) when
a session starts, so the rules apply from the next session. Recommend `{ "cleanupPeriodDays": 3650 }` in
`~/.claude/settings.json` (Claude Code deletes transcripts after 30 days by default), and name the plugin options
`save_chats` and `chats_dir` (in `/config`). A `chats_dir` other than `claude-chats` goes in `.dockerignore` too.
