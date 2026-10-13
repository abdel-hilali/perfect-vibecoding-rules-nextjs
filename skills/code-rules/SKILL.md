---
name: code-rules
description: Holds the code rules for a Next.js App Router app that talks to a separate backend API - size limits, the same-origin API relay, every read on the server, four guard layers, typed errors, automatic light/dark theme tokens, translation catalogs, tests and comments - and the check scripts that enforce them. Use when writing, reviewing or refactoring app code, adding a page, route, component, API call, string or colour, or when asked "what are the rules", "is this allowed" or "why does lint or check:structure fail".
---

# Code rules

The full text is `docs/RULES.md` in the project (R1 to R17). This is the summary: when a change comes close to
a rule, read the rule itself. Working code for each rule lives in the `recipes` skill
(`/perfect-vibecoding-rules-nextjs:recipes`, or `docs/playbooks/recipes/SKILL.md`).

## The ten rules that matter most

1. **Size limits, in counted lines** (blank and comment-only lines do not count). Source file 300, test file
   400, component function 190, function in `lib/`, `utils/` or `helpers/` 50, hook 60, any other function 60,
   API route file 150 and 50 per function. After each change run `eslint --max-warnings=0 <files you changed>`.
   Over a limit: split by responsibility, never squeeze lines. Purity is lint too: braces on every block, `===`,
   `const` when never reassigned, no duplicate imports, `import type` for types; `console.log` warns.
2. **The API relay.** The browser calls only same-origin `/api/*`. One route file per public path, named by
   intent, ids LAST: `src/app/api/<domain>/<action-in-kebab>/[id]/[sub]/route.ts`. The public path never mirrors
   the backend's. Each route file is one line over the ONE shared `proxy()`, which owns cookies, CSRF,
   `Set-Cookie`, the request id and errors. Route files exist only for what the browser calls. The backend URL
   variable is server-only: never `NEXT_PUBLIC_`.
3. **Every read on the server.** Server Components read through ONE server fetch module (`import "server-only"`,
   forwards the cookie jar, `cache: "no-store"` for per-user data, React `cache()` so a shared read runs once per
   request). Writes are Server Actions: validate with the schema, authorize, call the backend, revalidate. No
   GET with a side effect that a prefetch can reach: no `<Link>` to `/api/*`, downloads by `<a download>`,
   sign-out is a POST, the edge proxy redirects only GET and HEAD, `?next=` accepts only an app path.
4. **Four guard layers.** (1) The edge proxy (`src/proxy.ts`; `middleware.ts` before Next.js 16) judges only the
   path and the presence of a session cookie, never a role. (2) The authenticated layout calls
   `requireAuth(locale)` once. (3) Every gated `page.tsx` starts with `await requireAccess(locale, AREA, LEVEL)`
   and renders a server-side forbidden page. (4) The UI `<Gate>` only hides affordances; every Server Action and
   route re-checks; the backend has the last word. One access predicate, one permission ladder function.
5. **Typed errors.** The fetch layer throws a typed `ApiError` with the backend's `code`; never return a
   swallowed `null`. Branch on `code`, never on `message`. Never send a stack trace, an upstream URL or a token
   to the client.
6. **Theme tokens only, light and dark automatic.** A role sheet in `:root`, redefined wholesale in `.dark`;
   aliases declared once with `var()`; Tailwind v4 `@theme inline` exports them. Components use token utilities.
   A `dark:` variant or a raw palette colour (`bg-white`, `text-zinc-600`) is a lint error. The switch is the
   `.dark` class on `<html>`, set by next-themes (`attribute="class"`, `defaultTheme="system"`, `enableSystem`)
   before paint, with `suppressHydrationWarning` on `<html>`. Branch on `resolvedTheme`, never `theme` (under
   "system", `theme` is the string "system"). Every literal colour in `:root` also lives in `.dark`.
   Generated primitives in `src/components/ui/` are exempt from the theme rules and the size limits.
7. **Translations.** Catalogs in `messages/<locale>/`, mirroring the routes; `en` is the shape source. No
   literal user-facing text in components. Straight apostrophe (') only. Edit every locale together with small
   targeted edits, never a whole-file rewrite.
8. **Structure.** Components mirror routes; kebab-case file names; each domain folder `src/lib/apis/<domain>/`
   holds exactly `types.ts`, `form-schemas.ts`, `server-apis.ts`, `apis.ts`, `actions.ts`. No `"use client"`
   in `page.tsx` or `layout.tsx`. Never import an UPPER_CASE constant from a `"use client"` module into server
   code: it reads `undefined` there.
9. **Tests.** Unit tests for helpers, hooks, access logic and domain actions; a regression test for every bug
   fix; mock the network boundary, not internals; a coverage floor on `lib` (80% suggested); one run in a
   non-UTC timezone; E2E against a production build. Targeted checks while working, ONE full gate before a push.
10. **Comments say why**, in the code's own terms. Never cite a ticket, a decision id, a report, an agent or a
    job.

Also in `docs/RULES.md`: media and link wrappers (R9), environment (R10), forms (R11), feedback (R12), realtime
(R13), motion (R14), TypeScript, React and performance (R14b), the definition of done (R17) and the
anti-patterns list.

## Check your work

A change is done when its targeted checks pass (typecheck, `eslint --max-warnings=0` on the changed files, the
tests of the touched files, the check scripts). Each is seconds long.

| Command | Catches |
| --- | --- |
| `pnpm exec eslint --max-warnings=0 <changed files>` | size limits, `dark:`, raw colours, `"use client"` in a page or layout, purity (braces, `==`, `console.log`) |
| `pnpm check:structure` | domain files, route shape, ids last, kebab-case, components mirror, client constants, file sizes |
| `pnpm check:i18n` | missing or extra keys, files, locales; value kinds; `{placeholders}`; curly apostrophes |
| `pnpm check:json` | invalid JSON and duplicate keys in `messages/` |
| `pnpm check:theme` | a literal colour in `:root` with no `.dark` twin; a literal colour in `@theme` |

A batch is done when the ONE gate passes (verify, build, E2E), run once, right before the push, in a fresh
session (`/perfect-vibecoding-rules-nextjs:gate`, or `docs/playbooks/gate/SKILL.md`).

A check fails? Fix the code, not the check. If a rule is truly wrong for this project, say so to the owner
and change `docs/RULES.md` and the check together, on purpose.

## When a rule seems to block you

- A file must grow past its limit: split it first, then add the feature.
- No token fits a colour: add one to `:root` and `.dark`, then export it in `@theme inline`.
- The backend lacks what a screen needs: do not invent a shape. Say so to the owner.
- A test needs a raw class name as data: exempt that one test file in `eslint.config.mjs`, with a comment why.

## Setting the checks up

How to add the five scripts to a project, wire `eslint-rules.mjs` into `eslint.config.mjs` and configure
`check-structure.mjs`: [checks.md](checks.md).

In Claude Code: with the plugin installed, Claude loads this skill by itself when it writes or reviews app code;
you can also run it as `/perfect-vibecoding-rules-nextjs:code-rules`. The scripts ship in
`${CLAUDE_PLUGIN_ROOT}/templates/scripts/`, and `/perfect-vibecoding-rules-nextjs:new-project` copies them into
the project. The setup guide is `${CLAUDE_SKILL_DIR}/checks.md`.
