# perfect-vibecoding-rules-nextjs

Battle-tested rules for building Next.js (App Router) apps with an AI coding agent, usually beside a separate
backend API. One developer's working rules, learned the hard way on a real product, packed so that any developer
can drop them into any project.

The API relay rule (R2) assumes that backend: `check:structure` fails any file under `src/app/api/` that is not a
one-line relay over `proxy()`. If your app serves its own routes (an auth library, webhooks), decide first which
rules you keep, then change R2 in `docs/RULES.md` and the route check in `scripts/check-structure.mjs` together
(its `CONFIG` block has no per-route exception).

It is a Claude Code plugin and its own marketplace. It also works with any other AI coding tool: the rules live in
plain files (`AGENTS.md`, `docs/RULES.md` and the playbooks).

Built for Next.js 16 (App Router, `src/` folder), React 19, TypeScript and Tailwind CSS v4. The recipes use
next-themes, zod 4, react-hook-form, Vitest and Playwright.

You need: Node 18 or newer; Python 3 (for `check:json`); bash for the tools in `scripts/tools/` (macOS, Linux, or
WSL on Windows); Claude Code for the plugin. Details: [Where it runs](#where-it-runs), below.

In the kit's texts, "the owner" is you: the person who directs the AI in the project.

## What is inside

| Part | What it gives you |
| --- | --- |
| 10 skills | The rules and how-tos, loaded by Claude when a task matches (see the table below). |
| 2 hooks | A shell guard (blocks self-killing commands, warns you when a command can take the dev site down) and a chat saver. |
| Project templates | `AGENTS.md`, `CLAUDE.md`, the code rules, the working record, the backend-asks form, the builder rules. |
| Check scripts | Size limits, structure, translations, duplicate JSON keys, light/dark theme parity, ESLint rules. |
| Shell tools | Queued `tsc`/`eslint`/`vitest` for parallel agents, a dev-server keeper and memory guards, a safe port freer, an ownership sweep. |
| An installer | `install.mjs` copies the project files into an app, for any AI tool. |

The skills, as commands (`/perfect-vibecoding-rules-nextjs:<skill>`):

| Skill | Use it for |
| --- | --- |
| `code-rules` | The code rules: size limits, the same-origin API relay, reads on the server, four guard layers, typed errors, theme tokens, translations, structure, tests. |
| `recipes` | Working code for each rule: theme, i18n, API relay, server fetch, guards, forms, URL filters, toasts and error pages, realtime, motion, media and links, env, SEO, E2E, and the framework traps. |
| `screen` | Adding or changing a page, a tab or an endpoint, the project's way. |
| `gate` | The quality checks: targeted while working, one full gate right before a push. |
| `dev` | Starting, keeping up and recovering the dev server; freeing a port; a live API stays read-only. |
| `tools` | The shell tools in `scripts/tools/` and their settings. |
| `multi-agent` | Several builder agents in one working tree without losing work. |
| `session-rules` | Session boundaries, the handoff, surviving restarts, "stop everything", saving chats. |
| `working-rules` | Budget, progress updates, "where to look", short questions, outside edits, the backend asks. |
| `new-project` | Sets the kit up in an app. Only you start it; Claude never runs it by itself. |

## Install as a Claude Code plugin

Run this once in each project, from the project's folder:

```bash
claude plugin install perfect-vibecoding-rules-nextjs --marketplace abdel-hilali/perfect-vibecoding-rules-nextjs --scope project
```

It adds the marketplace to your user settings and turns the plugin on for the project in `.claude/settings.json`.
Commit that file: teammates then run the same command once. This one-step form needs a recent Claude Code
(v2.1.292 or later). On an older one, add the marketplace first:

```bash
claude plugin marketplace add abdel-hilali/perfect-vibecoding-rules-nextjs
claude plugin install perfect-vibecoding-rules-nextjs@perfect-vibecoding-rules-nextjs --scope project
```

The shell install may end with "2 userConfig options not yet set": that is fine, the defaults apply (chats saved,
into `claude-chats/`). To change them, see [Plugin options](#plugin-options) below.

Prefer to click? Inside a Claude Code session:

```text
/plugin marketplace add abdel-hilali/perfect-vibecoding-rules-nextjs
/plugin install perfect-vibecoding-rules-nextjs@perfect-vibecoding-rules-nextjs
```

The second command opens the plugin's page. It lists what the plugin adds, the two hooks included: read it, since
hooks run commands on your machine. Then pick a scope: for you in every project, for all collaborators on this
repository, or for you in this repository only.

### Start a new project

1. Create the app first: `pnpm create next-app@latest my-app` (TypeScript, ESLint, Tailwind CSS, the App Router,
   the `src/` folder). `create-next-app` wants an empty folder, so the kit comes after it.
2. In `my-app`, install the plugin (above) and start Claude Code.
3. Run `/perfect-vibecoding-rules-nextjs:new-project`, or `/perfect-vibecoding-rules-nextjs:new-project 3001` to
   set the dev port (default 3000).

Claude asks for the project's purpose in one line, then copies `AGENTS.md`, `CLAUDE.md`, `docs/`, `scripts/` and
the design-direction template into the app. It never overwrites a file. It adds the `package.json` scripts, wires
the ESLint rules, checks `.gitignore`, `.dockerignore` and `.gitattributes`, runs the checks once (a fresh app's
demo page fails the lint rules until new-project replaces it, with your yes) and writes the first entry of
`docs/PROGRESS.md`. You review with `git status`, commit, and open a new session, so Claude Code loads the new
`CLAUDE.md` and `AGENTS.md`. An existing app works the same way.

What the app gets:

| Path | What it is |
| --- | --- |
| `AGENTS.md` | Every always-on rule, for every AI tool. Most tools read it by themselves. |
| `CLAUDE.md` | `@AGENTS.md` (Claude Code imports it), then the Claude Code notes. |
| `docs/RULES.md` | The code rules, R1 to R17, with the reasons. |
| `docs/PROGRESS.md` | The working record. Its handoff block sits on top, for the next session. |
| `docs/BACKEND-ASKS.md` | The form for one self-contained asks file per part (`docs/BACKEND-ASKS-<n>.md`). |
| `docs/BUILDER-RULES.md` | The rules every parallel builder agent follows. |
| `scripts/` | The check scripts and `eslint-rules.mjs`. |
| `scripts/tools/` | The shell tools, set up in `scripts/tools/tools.env`. |
| `.claude/skills/design-direction/SKILL.md` | A form for the settled visual direction, to fill. |
| `docs/playbooks/` | The skills as plain files, for other AI tools. `new-project` adds them only when teammates use another AI tool. |
| `runs/` | Working files: briefs, reports, logs, backups. It ignores itself in git. |
| `claude-chats/` | Saved chat transcripts, made by the hook. It ignores itself in git. |
| `.dockerignore` | Keeps `claude-chats/` and `runs/` out of Docker images. Written only when the app has none. |
| `.gitattributes` | Keeps the shell tools' LF line endings in a Windows clone. Written only when the app has none. |

The `package.json` scripts (pnpm here; npm, yarn and bun work the same):

| Script | Command |
| --- | --- |
| `typecheck` | `tsc --noEmit` |
| `check:structure` | `node scripts/check-structure.mjs` |
| `check:i18n` | `node scripts/check-i18n.mjs` |
| `check:json` | `python3 scripts/check-json-dupes.py messages` |
| `check:theme` | `node scripts/check-theme.mjs` |
| `verify` | typecheck, lint, check:i18n, check:json, check:theme, check:structure, test |

### Plugin options

| Option | Default | What it does |
| --- | --- | --- |
| `save_chats` | `true` | Copy each session's transcript into the project. Set it to `false` to stop. |
| `chats_dir` | `claude-chats` | The folder, relative to the project root, that receives the copies. `~` and variables such as `$HOME` are not expanded. |

Change them in `/config` (each option is a row there), or in `/plugin` > Installed > the plugin > Configure options.
Claude Code saves the values under `pluginConfigs` in your user settings.

### Saved chats and your privacy

Claude Code keeps each session's transcript in your home folder, and deletes it after a while. The save-chat hook
keeps a copy inside the project, so the reasoning behind the work survives.

- When: each time Claude finishes a reply, before each compaction and at the end of the session.
- What: `<session-id>.jsonl` first, then the session's folder (subagent transcripts, tool results), only the
  files that changed. One line per run goes to `claude-chats/copies.log`.
- Where: `claude-chats/`, created with mode 700 and a `.gitignore` holding `*`, so the folder ignores itself.
- Docker and some deploy tools ignore `.gitignore`: list `claude-chats/` and `runs/` in `.dockerignore` and in your
  deploy tool's ignore file. The installer writes such a `.dockerignore` when the app has none.
- An absolute or `..` `chats_dir` falls back to `claude-chats`. The hook never writes into an existing folder that
  holds other files and has no `.gitignore` with `*`, so transcripts can never land in a tracked folder.
- The hook never prints, always exits 0, and stays inside the short time Claude Code gives hooks at session end.

**Transcripts are plain text and can hold secrets**: tokens, passwords, personal data, anything you pasted. Never
commit the folder, never share it, never paste from it. Back it up only to storage you control. To stop saving,
set `save_chats` to `false`.

**Keep Claude Code's own copies longer.** Claude Code deletes transcripts after `cleanupPeriodDays`, 30 days by
default. Put a large value in `~/.claude/settings.json` (the minimum is 1; 0 is rejected):

```json
{ "cleanupPeriodDays": 3650 }
```

### The Bash hook

Both hooks need `node` on PATH. The Bash hook (`hooks/guard-bash.mjs`) blocks the full-match `pkill -f`, and any
kill fed by a full-match `pgrep -f`, because both kill the calling shell itself: the pattern is also in that
shell's command line. It watches the Bash and PowerShell tools: on Windows, Claude Code usually runs commands
through PowerShell, which has no pkill, so there only the dev-port note applies.

It also adds a note for Claude (never a block) when a command builds, starts or E2E-tests the app, or names the
dev port. Claude reads that note only with the command's result, then tells you and restarts the keeper. When the
command can take the site down (a build, a start, an E2E run, `free-port.sh` on the dev port), the hook also shows
you a one-line warning as the command starts. Announcing such a job first stays Claude's rule (`AGENTS.md`). It
reads `DEV_PORT` from the environment, or else from `scripts/tools/tools.env` in the folder where Claude Code
started.

### Updates

A marketplace that is not Anthropic's does not update by itself. Update the plugin when you want:

```bash
claude plugin update perfect-vibecoding-rules-nextjs@perfect-vibecoding-rules-nextjs
```

Or turn on auto-update: `/plugin` > Marketplaces > `perfect-vibecoding-rules-nextjs` > Enable auto-update. A
running session keeps the old version: start a new session, or run `/reload-plugins`.

An update never touches the files already copied into your project: they are yours. To add template files that
are new in the kit, run `/perfect-vibecoding-rules-nextjs:new-project` again: the installer adds only missing
files. For a changed template, compare by hand.

### Uninstall

```bash
claude plugin uninstall perfect-vibecoding-rules-nextjs@perfect-vibecoding-rules-nextjs --scope project
claude plugin marketplace remove perfect-vibecoding-rules-nextjs
```

The files copied into the project stay. Delete what you no longer want. `claude-chats/` holds transcripts: delete
it, or keep it somewhere private.

## Without the plugin: copy the skills and wire the hooks by hand

Use this when you want the skills in every project on your machine, without a marketplace.

1. Get the kit, into a folder you keep (or download the ZIP):
   `git clone https://github.com/abdel-hilali/perfect-vibecoding-rules-nextjs.git`.
2. Copy the skills: `mkdir -p ~/.claude/skills && cp -R perfect-vibecoding-rules-nextjs/skills/* ~/.claude/skills/`.
   They then run as `/code-rules`, `/gate` and so on, without the prefix. Where a skill names
   `/perfect-vibecoding-rules-nextjs:gate`, read `/gate`. Paths written as `${CLAUDE_PLUGIN_ROOT}` mean your copy of
   the kit. A skill of yours with the same folder name is replaced: check `~/.claude/skills/` first.
3. Wire the hooks in `~/.claude/settings.json` (every project) or in a project's `.claude/settings.json`. Use the
   absolute path of your copy, and merge with the hooks you already have:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node", "args": ["/ABSOLUTE/PATH/perfect-vibecoding-rules-nextjs/hooks/guard-bash.mjs"], "timeout": 10 }
        ]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["/ABSOLUTE/PATH/perfect-vibecoding-rules-nextjs/hooks/save-chat.mjs"], "async": true }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["/ABSOLUTE/PATH/perfect-vibecoding-rules-nextjs/hooks/save-chat.mjs"], "timeout": 30 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node", "args": ["/ABSOLUTE/PATH/perfect-vibecoding-rules-nextjs/hooks/save-chat.mjs"] }] }
    ]
  }
}
```

Without the plugin there are no plugin options: the save-chat hook saves into `claude-chats/`. To stop it, leave
out its three entries.

4. Copy the project files into each app with the installer (next section).

To update: `git pull` in your copy of the kit, then copy the skills again (step 2). The hooks run from your copy,
so they update with the pull.

## Use it with any AI tool

The rules do not depend on Claude Code. Get the kit once, into a folder you keep:
`git clone https://github.com/abdel-hilali/perfect-vibecoding-rules-nextjs.git`. Then, from the folder that holds it:

```bash
node perfect-vibecoding-rules-nextjs/install.mjs path/to/my-app --port 3000
```

The installer copies `AGENTS.md`, `CLAUDE.md`, `docs/`, `scripts/`, the design-direction form, and the skills as
plain playbooks in `docs/playbooks/`, and writes a `.dockerignore` and a `.gitattributes` when the app has none.
It fills the project name (the folder's name), today's date and the dev port, and leaves the one-line purpose for
you. It never overwrites a file: it lists what it skipped, so running it twice is safe. Options: `--port N`
(default 3000), `--no-playbooks` (the Claude Code plugin already provides the skills), `--dry-run` (show the plan,
write nothing). Then ask your AI tool to follow `docs/playbooks/new-project/SKILL.md`: it adds the `package.json`
scripts and wires ESLint.

- **`AGENTS.md` holds every always-on rule.** Most AI coding tools read it at the project root by themselves.
- **A tool that reads only its own rules file** (such as `GEMINI.md`, `.cursor/rules/`, `.clinerules` or
  `.github/copilot-instructions.md`): point that file at `AGENTS.md`, with an import where the tool has one, or
  one line: "Read and follow AGENTS.md at the project root before any task."
- **The skills follow the open Agent Skills format** (a folder with a `SKILL.md` and its frontmatter). Nine load
  as they are in any tool that loads Agent Skills. `new-project` also uses two Claude Code fields
  (`disable-model-invocation`, `argument-hint`): delete those two lines before you load it elsewhere, since a
  strict loader (claude.ai upload, the Skills API) rejects unknown keys. Any other tool finds the skills through
  the "Playbooks" table at the end of `AGENTS.md`.
- **The two hooks are Claude Code only.** Their rules are also written in `AGENTS.md`: never `pkill -f`, kill by
  PID, announce before a job takes the dev port, keep chat transcripts in a folder that ignores itself in git.

To update: `git pull` in your copy of the kit, delete `docs/playbooks/`, and run the installer again. It never
overwrites a file, so only what you deleted is refreshed; compare a changed template by hand.

## Where it runs

| Part | macOS | Linux | Windows |
| --- | --- | --- | --- |
| The hooks, the check scripts and `install.mjs` (Node 18 or newer) | yes | yes | yes |
| The shell tools in `scripts/tools/` (bash) | yes | yes | inside WSL only |
| `check:json` (Python 3) | yes | yes | yes; the command may be `py` instead of `python3` |

- The shell tools need bash, git, Python 3, `ss` (Linux) or `lsof` (macOS), and `flock` for the queue (Linux has
  it; on macOS install it, or the queued checks warn and run without the queue).
- Git Bash lacks `ss`, `lsof` and `ps -o`, so the port and process tools (`free-port.sh`, `dev-keeper.sh`,
  `dev-guard.sh`, `vitest-memguard.sh`) cannot see the dev server there: on Windows, run them inside WSL.

## Contribute

Issues and pull requests are welcome. Keep the kit generic and plain:

- No name, host, port, account or date from a real project. Code examples use neutral names (`projects`,
  `invoices`, `members`) and `example.com`.
- Plain English, short sentences, imperative voice. Say what to do and why.
- A skill: a `SKILL.md` with `name` (the folder's name) and `description` (what it does, then "Use when ...", at
  most 600 characters). The most important rules go at the top; the body stays near 120 lines, and detail goes in
  supporting files. The body is tool-neutral; Claude Code mechanics go in one paragraph that starts with
  "In Claude Code:".
- Scripts: Node 18 ESM without dependencies, Python standard library run with `python3 -I`, bash with `set -u` that
  works on Linux and macOS. Each prints a usage line on wrong arguments and never needs the network. Comments say
  why. Never `pkill -f` or `pgrep -f` as a command.
- Each area has its tests in `tests/<area>/run.sh`, with fixtures in `tests/<area>/fixtures/`.

Run every test before a pull request, from any folder:

```bash
bash tests/run-all.sh                  # every area, about half a minute
bash tests/run-all.sh install static   # some areas only
```

The `static` area checks the syntax of every script, every JSON file, the skill format and the hook paths, and
scans for anything that looks like a real host, address or e-mail (the kit's own repository URL is the one
exception). It also runs `claude plugin validate .` when the `claude` CLI is installed. Two optional legs:
`ESLINT_DIR=<a project with ESLint 9>` lints sample files with the real ESLint, and
`TYPESCRIPT_MODULE=<path of the typescript package>` parses the recipes' TypeScript samples.

## License

MIT. See [LICENSE](LICENSE).
