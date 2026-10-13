# Recipe: the four guard layers

## Problem

A guard that lives in one place only (the edge, or a hidden button) can be skipped.
Two copies of an access check drift: the menu offers a page that the page then refuses.

## Rule

1. The edge `src/proxy.ts` (Next 16; `middleware.ts` before) judges only the PATH and the PRESENCE of a session
   cookie. A GET or HEAD for an app page without one goes to sign-in with `?next=`. Never a role.
2. The authenticated layout calls `requireAuth(locale)` once and filters the navigation with the same predicate.
3. Every gated `page.tsx` starts with `await requireAccess(locale, AREA, LEVEL)`; a refusal renders a forbidden page.
4. The UI `<Gate>` only HIDES affordances. Every Server Action and route re-checks; the backend is the final authority.

One access predicate (`canAccess`) and one permission-ladder function (`meets`). A `?next=` accepts only an app path.

## Code

```ts
// src/lib/access/can-access.ts (the ladder and the ONE predicate: nav, pages, <Gate> and actions call it)
export const LEVELS = ["NONE", "READ", "CREATE", "UPDATE", "DELETE"] as const;
export type Level = (typeof LEVELS)[number];
export type Area = "PROJECTS" | "INVOICES" | "MEMBERS";
export interface Principal { id: string; role: string; access: Partial<Record<Area, Level>> }
export interface AccessGate { area?: Area; level?: Level; roles?: readonly string[] }

/** The ONLY place that orders levels: holding UPDATE grants CREATE and READ. */
export function meets(held: Level | undefined, required: Level): boolean {
  return required === "NONE" || (held !== undefined && LEVELS.indexOf(held) >= LEVELS.indexOf(required));
}

export function canAccess(gate: AccessGate, principal: Principal | null): boolean {
  if (!principal || (gate.roles?.length && !gate.roles.includes(principal.role))) {
    return false;
  }
  return !gate.area || meets(principal.access[gate.area], gate.level ?? "READ");
}
```

```ts
// src/lib/access/guards.ts
import "server-only";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { isApiError } from "@/lib/api/errors";
import { fetchServer } from "@/lib/server/fetch-server";
import { canAccess, type Area, type Level, type Principal } from "./can-access";

/** One backend call per request: the layout, the page guard and every <Gate> share it. */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  try {
    return await fetchServer<Principal>("/auth/me");
  } catch (error) {
    if (isApiError(error) && (error.status === 401 || error.status === 403)) {
      return null;
    }
    throw error;
  }
});

export async function requireAuth(locale: string): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) {
    redirect(`/${locale}/sign-in`);
  }
  return principal;
}

export async function requireAccess(locale: string, area: Area, level: Level = "READ"): Promise<Principal> {
  const principal = await requireAuth(locale);
  if (!canAccess({ area, level }, principal)) {
    forbidden(); // renders app/[locale]/forbidden.tsx; needs experimental.authInterrupts in next.config.ts
  }
  return principal;
}
```

```ts
// src/lib/navigation/app-paths.ts (no "server-only": the proxy and the sign-in form use it)
import { isLocale } from "@/lib/i18n/config";

const APP_SEGMENTS = new Set(["dashboard", "projects", "invoices", "members", "settings"]);
const PROBE = "http://app.invalid";

export function isAppPath(pathname: string): boolean {
  const [root, locale, segment] = pathname.split("/");
  return root === "" && isLocale(locale) && segment !== undefined && APP_SEGMENTS.has(segment);
}

/** A `?next=` value, kept only when it resolves to an app page here. After sign-in: `safeNext(next) ?? home`. */
export function safeNext(value: string | null | undefined): string | null {
  const odd = [...(value ?? "")].some((c) => c === "\\" || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  if (!value?.startsWith("/") || value.startsWith("//") || odd) {
    return null;
  }
  const url = new URL(value, PROBE); // resolves dot segments the way a browser will
  const encodedSlash = /%2f|%5c/i.test(url.pathname); // a proxy that decodes first would route it elsewhere
  return url.origin === PROBE && !encodedSlash && isAppPath(url.pathname) ? url.pathname + url.search : null;
}
```

```ts
// src/proxy.ts (layer 1: a path and a cookie's presence, nothing else)
import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { pickLocale } from "@/lib/i18n/pick-locale";
import { isAppPath } from "@/lib/navigation/app-paths";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const locale = pathname.split("/")[1];
  if (!isLocale(locale)) {
    const rest = pathname === "/" ? "" : pathname;
    return NextResponse.redirect(new URL(`/${pickLocale(request)}${rest}${search}`, request.url));
  }
  // GET and HEAD only: a Server Action POSTs to its page URL, and a redirect would re-POST it to sign-in.
  const reading = request.method === "GET" || request.method === "HEAD";
  if (reading && isAppPath(pathname) && !request.cookies.has("access_token")) { // the NAME only
    const signIn = new URL(`/${locale}/sign-in`, request.url);
    signIn.searchParams.set("next", pathname + search);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
```

- Layer 2, `(app)/layout.tsx`: `const principal = await requireAuth(locale)`, then
  `NAV_ITEMS.filter((item) => canAccess(item, principal))`. The menu can never offer what a guard refuses.
- Layer 3, a gated page: `const { locale } = await params; await requireAccess(locale, "INVOICES");` first.
- Layer 4, `<Gate area="INVOICES" level="CREATE">`: an async Server Component that renders
  `canAccess(gate, await getPrincipal()) ? children : fallback`. Server Actions re-check with `runAction` (`forms.md`).

## Traps

- An edge layer has been bypassed before. It is a convenience, never the authorization.
- `/\evil.com`, `/%2f%2fevil.com` and `/en/x/../../api/export` all pass a "starts with one slash" test.
  Resolve a `?next=` against a probe origin and accept only an app path.
- A `redirect()` thrown under a `loading.tsx` boundary is streamed: a 200 plus a meta refresh, not a 307.
  Put a redirect that depends on the user (their role or kind of account) in a layout above the boundary.
- `redirect()`, `notFound()` and `forbidden()` throw. A `try/catch` around them swallows the navigation:
  call them outside the `try`, or rethrow with `unstable_rethrow(error)`.
- A cookie can be present but rejected: `requireAuth` redirects. To keep `?next=` there too, pass the path in a
  request header that the proxy always overwrites.
- A URL reachable from several roles needs an "any of these gates" guard, or the menu sends a user to a 403.
- With a short-lived access cookie, refresh it in the proxy BEFORE judging presence.
