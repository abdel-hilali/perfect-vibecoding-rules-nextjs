---
name: recipes
description: Gives working code recipes for a Next.js 16 App Router app (React 19, Tailwind v4) beside a separate backend API. Light/dark theme, translations, the API relay, server fetch and typed errors, the four guard layers, forms, URL filters, toasts and error pages, realtime sockets, motion, media and links, env checks, SEO, Playwright E2E, and the framework traps. Use when you build or fix one of these, ask "how do we do X here", add a page, form, filter bar, route handler or socket, or hit a strange Next.js or React bug.
---

# Recipes

Each recipe is one short file: the problem, the rule, minimal working code, and the traps.
Open only the recipe you need. The rules themselves live in `docs/RULES.md`; recipes show how to follow them.

## Before you copy code

- Copy the SHAPE, then rename to your domain. Names in the recipes are examples: `invoices`, `projects`,
  `members`, `example.com`.
- If the project already has the file a recipe shows (for example `src/lib/server/proxy-to-backend.ts`), follow
  and extend that file. Never create a second one.
- Read the recipe's Traps before you call the work done. Each trap cost someone hours.
- Stack: Next.js 16 App Router, React 19, Tailwind CSS v4, TypeScript strict, zod 4. Commands use pnpm;
  npm, yarn or bun work the same.
- A change is done when its targeted checks pass (typecheck, `eslint --max-warnings=0` on the changed files, the
  tests of the touched files, the check scripts). A batch is done when the ONE gate passes (verify, build, E2E),
  run once, right before the push, in a fresh session.

## Index

| Recipe | Open it when |
| --- | --- |
| [theme.md](theme.md) | Colours, light and dark, a `dark:` lint error, a white panel in the dark theme, a theme toggle. |
| [i18n.md](i18n.md) | Any user-facing text, a new page's catalog, the locale in a URL, a check:i18n failure. |
| [api-relay.md](api-relay.md) | The browser must call the backend: a new `src/app/api/**/route.ts`, cookies, CSRF, downloads. |
| [server-fetch.md](server-fetch.md) | A Server Component reads data, a typed `ApiError`, a CSRF 403, the browser's `clientFetch`. |
| [guards.md](guards.md) | Sign-in redirects, roles and permissions, `src/proxy.ts`, `requireAccess`, `<Gate>`, `?next=`. |
| [forms.md](forms.md) | A form, a zod schema, a Server Action, field errors, create and update schemas. |
| [url-filters.md](url-filters.md) | A filter bar, a search box, a list driven by query parameters, pagination with filters. |
| [feedback.md](feedback.md) | Toasts, `loading.tsx`, `error.tsx`, `not-found.tsx`, a skeleton, an error page message. |
| [realtime.md](realtime.md) | A socket, live badges or counts, a socket token, polling as the fallback. |
| [motion.md](motion.md) | An animation or transition, reduced motion, a dialog or drawer that moves. |
| [media-links.md](media-links.md) | Images, avatars, video, internal and external links, `next.config.ts` `images`. |
| [env.md](env.md) | A new environment variable, `.env` files, a Docker build, a build that calls `undefined/...`. |
| [seo.md](seo.md) | Page titles and descriptions, canonical and `hreflang`, `robots.ts`, `sitemap.ts`. |
| [e2e.md](e2e.md) | Playwright config or specs, flaky E2E, a fixture API, testing against a real backend. |
| [traps.md](traps.md) | Something "impossible" happens. Scan this list before you debug. |

## Related

- The code rules these recipes implement: `docs/RULES.md` (playbook `docs/playbooks/code-rules/SKILL.md`).
- Adding a whole screen: `docs/playbooks/screen/SKILL.md`. Running the quality gate: `docs/playbooks/gate/SKILL.md`.

## In Claude Code

In Claude Code: this skill is `/perfect-vibecoding-rules-nextjs:recipes`, and Claude loads it by itself when a
task matches. The recipe files sit beside this one, at `${CLAUDE_SKILL_DIR}/<recipe>.md`. The related skills are
`/perfect-vibecoding-rules-nextjs:code-rules`, `/perfect-vibecoding-rules-nextjs:screen` and
`/perfect-vibecoding-rules-nextjs:gate`.
