# {{PROJECT_NAME}}: the code rules

These are the standing rules for code in this project. Each one is a hard constraint, not a preference, and
each says what to do and why. Two other sources stand beside this file: the product rules (the conception) say
who may do what and which screens exist; the backend's documented API (the contract) says what the backend
serves. When a rule here and the code disagree, fix the code or change the rule on purpose. Never let them drift.

Working code for each rule: the `recipes` skill, or `docs/playbooks/recipes/` when the playbooks are installed.
Commands use pnpm; npm, yarn and bun work the same.

## R1 · Size limits and purity

Counted lines: blank lines and comment-only lines do not count.

| What | Limit |
| --- | --- |
| A source file | 300 lines |
| A test file | 400 lines |
| A component function | 190 lines |
| A function in `lib/`, `utils/` or `helpers/` | 50 lines |
| A hook | 60 lines |
| Any other function | 60 lines |
| An API route file | 150 lines, and 50 per function |

- Enforced by `scripts/eslint-rules.mjs` (ESLint `max-lines` and `max-lines-per-function`) and by the file-size
  check in `scripts/check-structure.mjs`.
- The size limits are lint warnings, so one old oversized file does not block the whole lint. Route limits are
  errors. Run `eslint --max-warnings=0 <the files you changed>`: new code fails the moment it goes over a limit.
- Over a limit? Split by responsibility: extract a component, a hook or a helper. Never squeeze lines together.
- The limits hold the app's code. The project's tooling in `scripts/` (the check scripts among it) is exempt.
- Generated primitives in `src/components/ui/` are exempt from the theme rules and the size limits: a generator
  writes them, and nobody edits them by hand.
- An old file may be tolerated over its limit only in `sizeExceptions` (top of `check-structure.mjs`), with the
  reason, until someone splits it. Only a file that was already too big when these rules arrived gets an entry.
- Purity, as lint errors (`hygieneRules` in `scripts/eslint-rules.mjs`): braces on every `if`, `else` and loop
  body (`curly`); `===`, never `==` (`eqeqeq`); `const` for what is never reassigned (`prefer-const`); one import
  statement per module (`no-duplicate-imports`; a separate `import type` line is fine). `console.log` is a warning
  in app code: `console.warn` and `console.error` are fine, and tests may log.
- Types come in through `import type` (`typeImportRules`, opt-in: it needs the TypeScript ESLint plugin that
  `eslint-config-next/typescript` brings).

## R2 · The API relay: same-origin, named by intent

The browser calls only same-origin `/api/*`. It never calls the backend directly.

- One route file per public path, named by intent, ids LAST:
  `src/app/api/<domain>/<action-in-kebab>/[id]/[sub]/route.ts`.
  Actions say what the call does: `list`, `get-by-id`, `create`, `update-by-id`, `remove-member`.
  `.../remove-member/[id]/[member]` is right; `.../[id]/members/[member]` is wrong.
- The public path never mirrors the backend's. `POST /api/auth/sign-in` may relay `POST /auth/login`.
  Why: the bundle then tells nothing about the API's shape, and the backend can move without a browser change.
- Each route file is one line over ONE shared `proxy()` (`src/lib/server/proxy-to-backend.ts`). The helper owns
  cookies, CSRF, `Set-Cookie`, the request id and errors. Never copy that logic into a route file.

  ```ts
  // src/app/api/projects/remove-member/[id]/[member]/route.ts
  import { proxy } from "@/lib/server/proxy-to-backend";

  export const DELETE = proxy(({ id, member }) => `/projects/${id}/members/${member}`);
  ```

- Route files exist only for what the browser calls. Server Components read through the server fetch module
  (R3) and need none.
- The backend URL variable (for example `BACKEND_API_URL`) is server-only. Never `NEXT_PUBLIC_`; it never
  reaches the bundle.
- `check-structure.mjs` fails on: a non-route file under `src/app/api`, a route that does not call `proxy()`,
  hand-rolled cookie or CSRF code in a route, a static segment after a dynamic one.

## R3 · Every read on the server

- The frontend never touches the database: no ORM, no connection string. Every read and every write is an HTTP
  call to the backend. App Router only: never the Pages Router.
- Reads happen in Server Components, through ONE server fetch module (`src/lib/server/fetch-server.ts`). It starts
  with `import "server-only"`, forwards the incoming cookie jar, uses `cache: "no-store"` for per-user data, and
  is the only module that knows the backend URL. Wrap reads that several components need in one request (the
  current user, the access map) in React `cache()`, so they run once per request.
- Writes go through Server Actions: validate with the schema, authorize, call the backend, revalidate.
- The browser talks only to same-origin `/api/*` (R2).
- No GET with a side effect that a prefetch can reach. Next.js prefetches links, so:
  - never a `<Link>` to `/api/*`;
  - downloads use an `<a download>` (through `AppAnchor` once the wrappers exist, R9), never a `<Link>`;
  - sign-out is a POST (a form or a Server Action), never a link;
  - the edge proxy redirects only GET and HEAD (a Server Action POSTs to its page's URL; a redirect breaks it);
  - a `?next=` return path accepts only an app path, never a full URL (an open redirect otherwise).
- Server Components by default. `"use client"` goes on the smallest leaf that needs the browser (state, effects,
  events). Never in `page.tsx` or `layout.tsx`: lint makes it an error, because a client page cannot export
  metadata. A page is a thin async shell: await the params, start the reads together (`Promise.all`), render.
- Never put per-user data in a shared cache. A read that forwards the session cookie is per-user by definition.

## R4 · Four guard layers, one access check

1. **The edge proxy** (`src/proxy.ts` in Next.js 16, `middleware.ts` before) looks only at the path and the
   presence of a session cookie. No session on an app page: redirect to sign-in with `?next=`. It never judges a
   role. Its matcher skips `api`, `_next` and static files.
2. **The authenticated layout** calls `requireAuth(locale)` once. It loads the user once per request.
3. **Every gated `page.tsx`** starts with `await requireAccess(locale, AREA, LEVEL)` (the locale is for the
   sign-in redirect). A refusal renders the forbidden page on the server.
4. **The UI `<Gate>`** only hides affordances: buttons, columns, tabs. Every Server Action and route re-checks
   access. The backend stays the final authority.

- One access predicate, `canAccess(gate, user)`, drives everything that is gated: the menu, `<Gate>`, the pages.
  One permission ladder function, `meets(held, required)`, compares levels (for example
  `NONE < READ < CREATE < UPDATE < DELETE`). Nothing re-implements the check.
- Access names and levels are `as const` objects or string unions that mirror the backend's enums, never
  TypeScript `enum`s: the backend sends plain strings, and a string union matches them as they are.
- Why four layers: edge-only checks have been bypassed in the wild, and a hidden button is not a permission.

## R5 · Typed errors, never a swallowed null

- The fetch layer throws a typed `ApiError` that carries the HTTP status and the backend's error `code`. A failed
  call never returns `null`, and never hides behind a `console.log`.
- Branch on `code`, never on `message`: the message may change without notice.
- Never send a stack trace, an upstream URL or a token to the client. Server Actions and routes return a safe,
  normalized error.
- The response envelope, `ApiError` and pagination types are declared ONCE (in `src/lib/api/`), never per domain.

## R6 · Theme: automatic light and dark, tokens only

Colours live only in tokens, in `src/app/globals.css`, in three layers:

1. **A role sheet** (`--surface`, `--on-surface`, `--primary`, ...) declared in `:root` and redefined wholesale
   in `.dark`.
2. **Semantic aliases** (`--background: var(--surface)`) declared ONCE with `var()`. The role underneath flips,
   so the alias follows.
3. **Tailwind v4 `@theme inline`** exports both as utilities (`--color-background: var(--background)`).

- Components use token utilities only: `bg-background`, `text-on-surface`, `border-outline`. No token fits? Add
  one to `:root` AND `.dark`.
- Lint errors (`themeRules` in `scripts/eslint-rules.mjs`): any `dark:` variant, and any raw palette colour
  (`bg-white`, `text-zinc-600`, `border-slate-200`, `bg-[#fff]`). They have no dark twin and no meaning.
- Generated primitives in `src/components/ui/` are exempt from the theme rules and the size limits. They keep the
  generator's `dark:` classes, which follow the `.dark` class through `@custom-variant dark` in `globals.css`.
  Your own code never writes `dark:`.
- The switch is the `.dark` class on `<html>`, set by next-themes: `attribute="class"`, `defaultTheme="system"`,
  `enableSystem`. Its blocking script sets the class before paint (no flash), so `<html>` carries
  `suppressHydrationWarning`. The user's choice persists across visits.
- A non-colour value that depends on the theme (which icon to show) branches on `resolvedTheme` in a client
  component, never on `theme`: under "system", `theme` is the literal string "system". `resolvedTheme` is
  unknown until mount, so render a neutral state first.
- Every literal colour token in `:root` must also be defined in `.dark`. `scripts/check-theme.mjs` enforces it:
  one missing token once gave the dark theme a white page. It also rejects a literal colour inside `@theme`. It
  reads a `:root` inside `@media (prefers-color-scheme: dark)`, the `create-next-app` starter's switch, as the dark
  sheet; the theme toggle needs the `.dark` class instead (the `theme` recipe).
- Name gradient utilities `wash-*`, never `bg-*`: class merging treats `bg-*` as a colour and drops the one
  beside it.

## R7 · Translations

- English and French catalogs (any set of locales works) live in `messages/<locale>/`, one file per route
  folder, mirroring the routes, plus shared files such as `common.json`. `en` is the shape source.
- The locale list and the default locale are declared once (`src/lib/i18n/config.ts`).
- No literal user-facing text in components. Tests import the catalog; they never retype a sentence.
- `scripts/check-i18n.mjs` checks: locale folders against the declared locales; the same files; the same keys
  (missing and extra); the same value kinds; the same `{placeholders}`. It also flags the curly apostrophe (’):
  every catalog uses the straight one ('), so a search or a test finds the text.
- `scripts/check-json-dupes.py` (recursive) catches invalid JSON and duplicate keys. `JSON.parse` keeps the last
  of two equal keys without a word, so "added the new line, forgot to remove the old one" passes every other check.
- Edit every locale together, with small targeted edits. Never rewrite a whole catalog file: keys that other
  code reads get lost.

## R8 · Structure

- Components mirror routes: a page's pieces live in `src/components/<route>/`. Cross-page pieces live in
  `src/components/shared/<area>/`, the media and link wrappers in `src/components/overrides/`, generated
  primitives in `src/components/ui/` (never edited by hand; exempt from the theme rules and the size limits).
- File names are kebab-case: `project-card.tsx`, never `ProjectCard.tsx`.
- Each backend domain has one folder, `src/lib/apis/<domain>/`, with exactly five files:
  - `types.ts`: entity, request and filter types, mirroring the contract;
  - `form-schemas.ts`: the zod schemas, the only validation (R11);
  - `server-apis.ts`: `import "server-only"`, reads through the server fetch module;
  - `apis.ts`: browser callers, same-origin `/api/*` only;
  - `actions.ts`: `"use server"` writes.
- What is not a backend domain stays out of `apis/`: `access/`, `api/` (envelope and errors), `server/`,
  `i18n/`, `media/`, `navigation/`.
- Shared code goes where its kind says, not where it is used: types in the domain's `types.ts`, the backend's
  enums included (cross-domain types in `src/lib/types/`); other constants in `src/lib/constants/`; pure helpers
  (no side effects) in `src/lib/helpers/`. A small standalone one may sit flat in `src/lib/<name>.ts`. Never
  declare a shared type inline in a component.
- Features never import each other's internals. Two features need the same piece? Lift it to `shared/`.
- No playground or demo component in `src/components`.
- A constant exported from a `"use client"` module is a client reference on the server: its fields read
  `undefined`. Keep constants in a plain module that both sides import.
- `check-structure.mjs` enforces the five files, kebab-case, the mirror, the client-constant trap and the sizes.

## R9 · Media and link wrappers

- Images and links go through wrappers in `src/components/overrides/` (`AppImage`, `AppLink` for internal
  links, `AppAnchor` for external ones), over one pure, tested `resolveMediaUrl()`.
- Never a raw `next/image`, `next/link`, `<img>` or `<a>` outside the wrappers. `wrapperRules` in
  `scripts/eslint-rules.mjs` turns this into a lint error once the wrappers exist.
- `images.remotePatterns` lists the real media hosts, `https` only. Never a wildcard: it turns the image
  optimizer into an open proxy.
- `next/image`'s `priority` is deprecated in Next.js 16: put `preload` on the one image that is the page's
  largest paint, and give the others `sizes`.

## R10 · Environment

- `.env*` is git-ignored, except `.env.example` (placeholders only, every variable documented).
- A schema-driven env check (each variable declares build or runtime scope; see the `env` recipe) runs before
  every build, so missing config fails fast.
- `NEXT_PUBLIC_*` values are inlined at build time and ship to every browser. Never a secret, never the backend
  URL. Changing one needs a rebuild.
- Never log a secret, a token or personal data.

## R11 · Forms

- react-hook-form with `zodResolver`, over the domain's `form-schemas.ts`. The schema is the only validator:
  never re-check a field by hand. Types come from `z.infer`.
- Update schemas derive from the create schema (`.partial()`, `.pick()`, `.omit()`), never a copy.
- The Server Action validates again with the same schema. Send exactly the fields the contract lists: a strict
  backend rejects unknown ones.
- A filter bar is a GET form: the URL is the state, never client state.

## R12 · Feedback

- One toaster, mounted once, in the layout that wraps every page that calls `toast()` (the root layout, or the
  app group's layout). All feedback goes through it.
- Every route segment ships `loading.tsx` (a skeleton in tokens) and `error.tsx`, plus `not-found.tsx` where a
  lookup can miss.

## R13 · Realtime with a REST fallback

- A socket connects with a short-lived token exchanged on the server. The session cookie never touches
  JavaScript.
- One typed manager per namespace; event names come from a typed event map.
- Anything a socket pushes (a badge, a count) is also readable over REST. Sockets drop; the page must not lie.

## R14 · Motion: felt, not watched

- 150 to 300 ms (400 ms only for a drawer or a sheet sliding in), and only to explain a change (something
  arrived, opened, moved, is working). It runs once. Nothing bounces for attention.
- Durations and easings come from tokens. Reduced motion means none: one base rule collapses every animation
  and transition.
- Animate only opacity, scale, translate, rotate, shadow and colour. Never layout.
- Enters keep no fill or use `backwards`; only exits use `forwards`. A retained `translate` makes the element the
  containing block of every `position: fixed` child, and dialogs break.
- No stagger cascades: things that land together land together.
- Loops run only while a live state is true: a skeleton while loading, a spinner while busy.

## R14b · TypeScript, React and performance

- No `any`: use precise types, `unknown` with narrowing, or generics. No `@ts-ignore` or `@ts-expect-error`
  without a one-line reason.
- Keys come from stable ids, never the array index.
- A custom hook starts with `use` and holds no JSX.
- No `useMemo`, `useCallback` or `React.memo` without a profiling reason.
- Heavy or below-the-fold client code loads with `next/dynamic`.
- No request waterfalls: start independent reads together (`Promise.all`), and dedupe shared ones with React
  `cache()`.
- A slow read streams behind `<Suspense>` or a `loading.tsx`. It never blocks the whole route.
- Fonts come from `next/font`: self-hosted, no third-party request at run time.

## R15 · Tests

- Unit tests for helpers, hooks, access logic (the ladder and the predicate) and domain actions.
- Every bug fix gets a regression test.
- Mock the network boundary (the server fetch module, the relay), not internal functions.
- A coverage floor on `src/lib/**` (80% suggested): `test:coverage` = `vitest run --coverage` (with
  `@vitest/coverage-v8`), and in `vitest.config`, under `test`:
  `coverage: { include: ["src/lib/**"], thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 } }`.
- The unit suite runs once more in a non-UTC timezone, because date bugs hide in UTC:
  `test:tz` = `TZ=Pacific/Auckland vitest run` (it needs a POSIX shell: on Windows, run it inside WSL).
- E2E runs against a production build (`next build` then `next start`), never `next dev`, with the locale pinned.
- One E2E accessibility spec visits every page: `lang` is set, there is a single `h1`, every image has an `alt`,
  the focus order follows the layout.
- Contract tests keep files that must agree in agreement: the port in the scripts, the Dockerfile and compose;
  pinned versions; the CSP.
- While working, run targeted checks only (types, lint on changed files, the test files you touched, the check
  scripts). Run ONE full gate right before a push (the `gate` skill).

## R16 · Comments say why

- A comment says why, in the code's own terms: the constraint, the trap, the reason for an odd choice.
- Never cite a ticket, a decision id, a report, an agent or a job. They mean nothing to the next reader, and
  they rot.
  - Bad: `// fix for the item 12 review`
  - Good: `// The backend rejects unknown fields, so send only the documented ones.`

## R17 · The quality gate and done

`pnpm verify` = `typecheck` → `lint` → `check:i18n` → `check:json` → `check:theme` → `check:structure` → `test`.
Once the project has them, `verify` ends with `test:coverage` and `test:tz` in place of `test` (R15).

A change is done when its targeted checks pass (typecheck, `eslint --max-warnings=0` on the changed files, the
tests of the touched files, the check scripts), with no rule disabled to get there, and every box below holds:

- [ ] tests are written and pass; a bug fix has its regression test;
- [ ] reads happen on the server; per-user data is never in a shared cache;
- [ ] inputs are validated by the schema, and access is checked in the page, the action and the route;
- [ ] no secret, upstream URL or personal data reaches the client or the logs;
- [ ] files sit where R8 says, within the R1 limits; media and links go through the wrappers;
- [ ] every new string is in every catalog; every new colour is a token in `:root` and `.dark`;
- [ ] new pages export their metadata;
- [ ] no unused dependency; CI actions are pinned to a full commit SHA; the container runs as non-root.

A batch is done when the ONE gate passes (verify, build, E2E), run once, right before the push, in a fresh session
(the `gate` skill). Never run the full gate or a build after each change: the build takes the dev port.

## Anti-patterns: never again

- `dark:` sprinkled per page because a colour was not a token.
- The API envelope re-declared in every domain.
- Auth checked only in the browser (a provider fetching the user), with nothing on the server.
- One hand-written forwarding route per endpoint.
- A fetch helper that returns `null` on failure and logs to the console.
- A wildcard `images.remotePatterns` (`hostname: "**"`, or `http:`).
- Forms that drift from the schema into one `useState` per field.
- 1,000-line components, PascalCase files, playground components shipped.
- A committed `.env`, or a `.gitignore` that also hides `.env.example`.
- `any`, or `@ts-ignore` without a one-line reason.
- A whole catalog file rewritten to change one string.
