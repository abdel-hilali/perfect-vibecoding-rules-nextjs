# Setup notes

Details for steps 4, 6 and 7 of the new-project playbook.

## The starter files (step 6)

A fresh `create-next-app` ships two files that the rules flag. Replacing either one replaces a file: ask the owner
first and show the diff.

- `src/app/globals.css` switches dark mode with `@media (prefers-color-scheme: dark)`. `check:theme` accepts it:
  that `:root` is the dark sheet. When the project adds a theme toggle, replace the media query with the
  class-based setup of the theme recipe: the role sheet in `:root` and `.dark`, `@theme inline` (keep the font
  variables), and next-themes with its provider in the root layout (a new dependency: ask first).
- `src/app/page.tsx`, the demo page, uses `dark:` variants and palette classes (`bg-zinc-50`, `text-black`), so
  lint fails on it. Offer to replace it with a small page that uses token utilities only (`bg-background`,
  `text-foreground`).
- The other starter files (`layout.tsx`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`) pass every
  check script and the lint rules as they are.

## Optional test scripts (step 4)

Once the unit suite exists, two scripts serve the tests rule (R15 in `docs/RULES.md`):

- `test:coverage` = `vitest run --coverage`, with a floor on `src/lib/**` in `vitest.config`:
  `coverage: { include: ["src/lib/**"], thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 } }`.
  The coverage provider is a new dev dependency: ask first.
- `test:tz` = `TZ=Pacific/Auckland vitest run`: date bugs hide in UTC. On Windows, run it inside WSL.

Once both exist, `verify` ends with them in place of `test`.

## Line endings and build ignores (step 7)

- `.dockerignore`: `claude-chats/` (the saved chats, which can hold secrets) and `runs/` (backups, logs). Docker
  and some deploy tools ignore `.gitignore`, so a `COPY . .` would put both in the image. A deploy tool that
  uploads the folder needs the same lines in its own ignore file.
- `.gitattributes`: `*.sh text eol=lf`, `*.py text eol=lf` and `scripts/tools/tools.env text eol=lf`. A Windows
  clone checks text out with CRLF by default, and bash rejects it.
- The installer writes each file when it is missing. An existing one is never edited: the installer names the
  lines it lacks, and you add them as one of the setup edits (rule 1).
