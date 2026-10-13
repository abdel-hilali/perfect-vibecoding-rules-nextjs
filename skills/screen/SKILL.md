---
name: screen
description: Builds or changes a screen of the Next.js app the project's way - settle doc conflicts first (the product rules win), confirm the backend serves it or ship a guarded "coming soon" page plus a backend ask, build to the code rules, register the route in the tests, then gate. Use when adding a page, a tab or a sidebar entry, wiring a new endpoint, or reworking an existing screen.
---

# Build a screen

Five steps, in order. Skipping step 0 is the most expensive mistake: a conflict settled after the build is baked
into code and costs a rebuild.

## 0. Settle doc conflicts BEFORE writing code

Three sources govern a screen. Each is the authority for one thing:

| Source | Authority for |
|---|---|
| The conception (the product rules) | The rules: tabs, access, flows. It wins any conflict. |
| The backend contract (its documented API) | What can be called, with which fields. |
| The prototype or design mockups | The layout. |

- When they disagree, stop and ask the owner. One short question: the readings side by side, your
  recommendation first. Never pick silently.
- Then record the answer: amend the conception (a numbered decision in `docs/PROGRESS.md`), or file a backend ask.
- What the conception does not name is built only on the owner's yes.

## 1. Confirm the backend serves it

- Find each call the screen needs in the backend contract, and check the real backend answers it (read-only).
- Read the backend's change notes since your last pull. They can change error codes, rate limits or field
  meaning (a list field that now replaces the set instead of adding to it).
- Missing a route or a field? Do not work around it. Add an ask to the newest UNSENT asks part
  (`docs/BACKEND-ASKS-<n>.md`) and tell the owner, who carries it to the backend team. A sent part is never edited.
- Cannot build it yet? Ship a real page anyway: guarded like the finished one, translated, with a body that says
  "coming soon". Register it in the upcoming-screens list (for example `src/lib/navigation/upcoming-screens.ts`)
  with its access gate and what it waits for. The row leaves the list the day the screen ships.
- **Every sidebar tab leads to a page.** Never a dead link, never a 404 behind a menu entry.

## 2. Build to the rules

The full rules are in `docs/RULES.md` (summary: the code-rules playbook, `/perfect-vibecoding-rules-nextjs:code-rules`
or `docs/playbooks/code-rules/SKILL.md`). Working code for each pattern: the recipes playbook
(`/perfect-vibecoding-rules-nextjs:recipes`, or `docs/playbooks/recipes/SKILL.md`). The ones most often broken:

- **Theme:** colours from tokens only. No `dark:` variants, no raw palette classes. A new token goes in both
  `:root` and `.dark`. Name gradient utilities `wash-*`, never `bg-*`: `tailwind-merge` drops a colour beside them.
- **Text:** no literal user-facing text. Both catalogs (EN and FR) change together, by small edits.
- **Structure:** components mirror the routes. The domain lives in its five files: `types.ts`, `form-schemas.ts`,
  `server-apis.ts`, `apis.ts`, `actions.ts`.
- **Data:** reads in Server Components through the server fetch module. Writes through Server Actions. The
  browser calls only same-origin `/api/*`, and the backend URL never reaches it.
- **Guards:** the page starts with `await requireAccess(locale, AREA, LEVEL)`. `<Gate>` only hides buttons; every
  action checks again.
- **Wrappers:** images and links through the project's wrappers, never raw `next/image`, `next/link`, `<img>`, `<a>`.
- **Forms:** the schema is the only validator. **Size:** a file at most 300 counted lines, a component 190
  (the lint limits catch the rest).
- **Motion:** 150 to 300 ms (400 ms only for a drawer or a sheet), tokens only, none under reduced motion.

Before you change a colour, `globals.css`, the top bar or the sidebar, read the project's design direction
(`.claude/skills/design-direction/SKILL.md`). It holds the settled corrections; do not reopen them.

## 3. Register the route in the tests

- Add the route to the routes test (for example `src/lib/navigation/routes.test.ts`) and to the navigation E2E
  (for example `e2e/navigation.spec.ts`). Both fail when a page disappears or a tab leads nowhere.
- Unit-test the new helpers, access logic and actions. A bug fix gets a regression test.

## 4. Gate it

- While building: targeted checks only. A change is done when they pass (typecheck, `eslint --max-warnings=0` on
  the changed files, the tests of the touched files, the check scripts). See the gate playbook
  (`/perfect-vibecoding-rules-nextjs:gate`, or `docs/playbooks/gate/SKILL.md`), tier 1.
- Its batch is done when the ONE gate passes (verify, build, E2E), run once, right before the push, in a fresh
  session.
- Tell the owner where to see it: the page, the role or account to sign in with, what they will see, and what not
  to click because it writes real data. For plumbing with nothing visible, say so.

In Claude Code: in a project created with `/perfect-vibecoding-rules-nextjs:new-project`, the design direction
is a project skill and loads by itself when a design task starts.
