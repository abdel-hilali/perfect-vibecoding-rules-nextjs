# Recipe: Next.js and React traps that cost real time

## Problem

Some bugs look impossible: a constant is `undefined`, a dialog sits in the wrong place, a GET fires by itself.
Each one below cost hours once. Reading two lines costs seconds.

## Rule

- When something "cannot happen", scan this list before you debug.
- Each entry: the symptom first, then the cause and the fix.
- Found a new one? Add it here in two lines, and add a test that would have caught it.

## Code

```ts
// src/lib/apis/invoices/types.ts (directive-free: Server and Client Components can both read it)
export const INVOICE_STATUS = { DRAFT: "DRAFT", SENT: "SENT", PAID: "PAID" } as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];
```

```ts
// A catch that must not swallow a navigation
import { notFound, unstable_rethrow } from "next/navigation";
import { isApiError } from "@/lib/api/errors";
import { fetchServer } from "@/lib/server/fetch-server";

export async function loadInvoice(id: string): Promise<{ id: string }> {
  try {
    return await fetchServer<{ id: string }>(`/invoices/${encodeURIComponent(id)}`);
  } catch (error) {
    unstable_rethrow(error); // redirect(), notFound() and forbidden() work by throwing
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }
}
```

```tsx
// The one LCP image of a page: `preload`, not `priority` (deprecated in Next 16)
<AppImage src={hero.url} alt={hero.alt} width={1200} height={600} sizes="100vw" preload />
```

## Traps

- **A constant from a `"use client"` module is `undefined` on the server (`STATUS.PAID` reads nothing).**
  Every non-component export of a client module is a client reference there. Move it to a directive-free module.
- **The theme icon is wrong on a dark OS.**
  Under `defaultTheme="system"`, `theme` is the literal `"system"`. Branch on `resolvedTheme`.
- **`next/image` warns about `priority`.**
  It is deprecated in Next 16. Use `preload` on the single LCP image; set `sizes` on responsive images.
- **A `position: fixed` dialog is pinned inside a section instead of the viewport.**
  An ancestor kept a `translate` from an enter animation (`both`, `forwards`). Enters: no fill mode, or `backwards`.
- **A GET relay fires without a click (an export counted, a mail sent).**
  A `<Link>` prefetch, an `<img>` or a crawler reached it. Never `<Link>` to `/api/*`; download with `AppAnchor` and `download`.
- **A read in a layout runs on every hover of a link.**
  A default prefetch renders down to the first `loading.tsx`. Keep costly reads in the page body, below it.
- **A redirect answers 200 with a meta refresh instead of a 307.**
  It was thrown under a `loading.tsx` boundary, so it streamed. Redirect from a layout above the boundary.
- **`redirect()` or `notFound()` turns into an error page.**
  They throw, and a `try/catch` caught them. Call them outside the `try`, or `unstable_rethrow(error)` first.
- **`forbidden()` shows the generic error page.**
  It needs `experimental: { authInterrupts: true }` in `next.config.ts`.
- **Your utility classes are ignored on a third-party widget.**
  Its runtime CSS is unlayered and beats `@layer utilities`. Use its unstyled mode. Your own unlayered CSS wins too.
- **A background colour vanishes when a gradient class is added.**
  `tailwind-merge` treats every `bg-*` as one group: name gradients `wash-*`. It also keeps only the last `animate-*`.
- **A filter field shows an old value after Back or "Clear", and sends it again.**
  React never re-applies a changed `defaultValue` to a mounted field; Next does not remount on a query-only change.
- **Every relayed response over a few KB fails as a network error.**
  The relay copied `content-encoding` after `fetch` had decoded the body. Drop it, and `content-length` with it.
- **Server Action writes pass locally and 403 in production.**
  Node sends no `Origin`, and the backend's CSRF check wants a trusted one. Forward the browser's `origin`, `referer`.
- **The production error page only says "something went wrong".**
  An error boundary gets only the `digest`. Show it as the support reference; encode a known answer into it.
- **`middleware.ts` is ignored or warned about on Next 16.**
  Rename it `proxy.ts` and export a function named `proxy`. Renamed config flags use the `proxy` prefix.
- **A Server Action fails right after the session lapsed.**
  The edge redirected its POST to sign-in. Redirect only GET and HEAD: an action posts to its page URL.
- **A "stay visible while a menu is open" selector is always true.**
  `[aria-expanded=true]` also matched the navigation toggle. Scope it: `[aria-haspopup][aria-expanded=true]`.
- **WebKit E2E renders pages without CSS on localhost.**
  `upgrade-insecure-requests` in the CSP rewrote `http://localhost` to https. Leave it out; use HSTS in production.
- **Users with several tabs open get signed out when the access token lapses.**
  Each 401 redeemed the refresh token, and a reused refresh token reads as theft. Refresh once: one shared promise.
- **A `webpack()` function in `next.config.ts` breaks the build.**
  Turbopack is the default bundler in Next 16. Port custom loaders to `turbopack.rules`.
- **"params should be awaited", or `params.id` is a Promise.**
  `params`, `searchParams`, `cookies()` and `headers()` are async since Next 15. Await them.
- **A query value crashes a page: `toLowerCase is not a function`.**
  A search param can be `string | string[]`. Take the first value and parse it with a schema that `.catch`es.
- **Turning on `cacheComponents` breaks many pages at once.**
  It needs a `<Suspense>` around every uncached read. It is an app-wide migration: plan it, never flip it in passing.
- **Retrying after a 429 makes the wait longer.**
  Many limiters count refused requests too. Wait for `Retry-After`, and remember it across reloads.
- **One account's lockout blocks another account in the same browser.**
  `localStorage` is per origin, not per user. Key stored state by user id.
- **A route param of `..` reaches another backend route.**
  Next decodes params. The relay encodes each segment and refuses `.` and `..`.
- **`next/image` answers 400 "isn't a valid image" for a private file.**
  The optimizer fetches without cookies. Mark session-protected sources `unoptimized`.
