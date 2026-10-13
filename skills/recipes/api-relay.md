# Recipe: the API relay (`proxy()` and one-line route files)

## Problem

The browser must call the backend with the session cookie, yet never learn where the backend lives.
Hand-written forwarding in every route file drifts: sooner or later one forgets a header.

## Rule

- The browser calls only same-origin `/api/*`. Server Components do not need a route: they use `fetchServer`
  (see `server-fetch.md`). Route files exist only for what the browser calls.
- One route file per public path, named by intent, ids LAST:
  `src/app/api/<domain>/<action-in-kebab>/[id]/[sub]/route.ts`. Never an id between path words.
- The public path never mirrors the backend's. The upstream path stays on the server.
- Each route file is ONE line over ONE shared `proxy()` that owns cookies, the CSRF header, the `Set-Cookie`
  relay, the request id, timeouts and errors.
- The backend URL variable (`BACKEND_API_URL`) is server-only: never `NEXT_PUBLIC_`, never in the bundle.
- Never a `<Link>` to `/api/*` (a prefetch would call it). A download is a plain `<a href download>` (the
  `AppAnchor` wrapper with `download`, see `media-links.md`).

## Code

```ts
// src/lib/server/backend-url.ts
import "server-only";

const API_PREFIX = "/api/v1"; // your backend's global prefix, or ""

export function backendUrl(path: string): string {
  const origin = process.env.BACKEND_API_URL;
  if (!origin) {
    throw new Error("BACKEND_API_URL is not set. It is server-only; see .env.example.");
  }
  return `${origin.replace(/\/+$/, "")}${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
}
```

```ts
// src/lib/server/proxy-to-backend.ts
import "server-only";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { backendUrl } from "./backend-url";

// Allowlists: everything else is dropped. origin and referer feed the backend's CSRF check.
const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "cookie", "origin", "referer",
  "user-agent", "x-csrf-token", "x-request-id"];
// No content-encoding: fetch already decoded the body.
const RESPONSE_HEADERS = ["content-type", "content-disposition", "content-length", "etag",
  "last-modified", "retry-after", "x-request-id"];

type Params = Record<string, string>;
type RouteContext = { params?: Promise<Record<string, string | string[] | undefined>> };

function jsonError(error: ApiError, request: NextRequest): Response {
  const requestId = request.headers.get("x-request-id") ?? "";
  return Response.json(
    { statusCode: error.status, code: error.code, message: error.message, requestId },
    { status: error.status, headers: { "cache-control": "no-store" } },
  );
}

async function relay(request: NextRequest, path: string, timeoutMs: number): Promise<Response> {
  const target = new URL(backendUrl(path));
  target.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  const method = request.method.toUpperCase();
  let upstream: Response;
  try {
    // Read the browser's body first: the timeout must not bound the user's own upload.
    const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
    upstream = await fetch(target, {
      method, headers, body,
      redirect: "manual", // never carry the cookie to another host
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return jsonError(ApiError.unreachable(error), request);
  }
  const out = new Headers({ "cache-control": "no-store" });
  const decoded = upstream.headers.has("content-encoding");
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value && !(decoded && name === "content-length")) {
      out.set(name, value);
    }
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    out.append("set-cookie", cookie); // sign-in, refresh and sign-out live or die here
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/** Turns an upstream path into a route handler. */
export function proxy(upstream: string | ((params: Params) => string), { timeoutMs = 15_000 } = {}) {
  return async function handler(request: NextRequest, context?: RouteContext): Promise<Response> {
    const raw = (await context?.params) ?? {}; // a static route gets no params at all
    const params: Params = {};
    for (const [key, value] of Object.entries(raw)) {
      const segments = value === undefined ? [] : Array.isArray(value) ? value : [value];
      if (segments.some((segment) => segment === "." || segment === "..")) {
        return jsonError(new ApiError({ statusCode: 400, code: "BAD_REQUEST", message: "Bad path." }), request);
      }
      params[key] = segments.map(encodeURIComponent).join("/");
    }
    return relay(request, typeof upstream === "function" ? upstream(params) : upstream, timeoutMs);
  };
}
```

```ts
// src/app/api/invoices/remove-member/[id]/[member]/route.ts
import { proxy } from "@/lib/server/proxy-to-backend";

export const DELETE = proxy(({ id, member }) => `/invoices/${id}/members/${member}`);
```

```ts
// src/app/api/auth/sign-in/route.ts (the public name need not match the backend's)
import { proxy } from "@/lib/server/proxy-to-backend";

export const POST = proxy("/auth/login");
```

## Traps

- Many backend CSRF checks also want a trusted `origin` (or `referer`). Drop those headers and every write
  passes locally, where CSRF is often off, and fails with 403 in production.
- Relaying `content-encoding` labels decoded bytes as gzip: the browser fails to decode every compressed response.
  Drop `content-length` too when the upstream body was encoded.
- Read `Set-Cookie` with `getSetCookie()`. `headers.get("set-cookie")` joins them with commas and breaks `Expires`.
- Next decodes route params. Encode each segment and refuse `.` and `..`, or an id walks the upstream path.
- A file upload or download needs a longer timeout. For a streamed export, stop the clock once headers arrive.
- A public relay that works from a token in the body must forward no cookie and no CSRF header, and relay no
  `Set-Cookie`: a stale session cookie in that browser could make the backend demand a CSRF token.
- A GET with a side effect (an export, a counter) can be hit by a prefetch, an `<img>` or a crawler. Check
  `next-router-prefetch` and `sec-fetch-mode: navigate` in that one route, and disallow `/api/` in `robots.ts`.
- Exclude `api` from the edge proxy matcher (see `guards.md`).
