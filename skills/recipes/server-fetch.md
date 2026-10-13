# Recipe: server fetch, typed errors and the browser caller

## Problem

A fetch helper that returns `null` on failure makes a broken screen look like an empty one.
Server code that builds its own headers forgets the session, the CSRF echo or the origin.

## Rule

- Server Components and Server Actions reach the backend through ONE module, `src/lib/server/fetch-server.ts`:
  `import "server-only"`, forwards the cookie jar, `cache: "no-store"` for per-user data. Wrap a read many
  components need (the signed-in user) in React `cache()`: one call per request (`getPrincipal`, `guards.md`).
- Failures THROW a typed `ApiError` with the backend's `code`. Branch on `code`, never on `message`.
  Only a lookup that may miss turns a 404 into `null` (`fetchServerOrNull` in `feedback.md`).
- Never leak a stack trace, an upstream URL or a token to the client. A transport failure becomes a generic
  `UPSTREAM_UNAVAILABLE` or `UPSTREAM_TIMEOUT`.
- Send exactly the documented fields. A strict backend (whitelist plus "forbid unknown") rejects the whole request
  for one extra key: a leftover form field, an echoed `id`. Build bodies from an allowlist (`forms.md`).
- The browser calls same-origin `/api` through ONE `clientFetch`. A 403 with the backend's CSRF code is
  recoverable: one cheap GET re-plants the cookie, then retry ONCE. Never sign the user out over it.

## Code

```ts
// src/lib/api/errors.ts (no "server-only": the browser uses it too)
export interface ApiErrorBody { statusCode: number; code: string; message: string; requestId?: string }

export class ApiError extends Error {
  readonly status: number;
  readonly code: string; // branch on this, never on message
  readonly requestId: string;
  readonly retryAfterSeconds?: number;
  constructor(body: ApiErrorBody, retryAfterSeconds?: number) {
    super(body.message);
    this.name = "ApiError";
    this.status = body.statusCode;
    this.code = body.code;
    this.requestId = body.requestId ?? "";
    this.retryAfterSeconds = retryAfterSeconds;
  }
  static async fromResponse(res: Response): Promise<ApiError> {
    const retry = Number(res.headers.get("retry-after")); // a missing header gives 0: "no hint"
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    const known = typeof body?.code === "string" && typeof body.statusCode === "number";
    return new ApiError(known ? (body as ApiErrorBody) : { statusCode: res.status, code: "UNKNOWN",
      message: res.statusText || `HTTP ${res.status}` }, retry > 0 ? retry : undefined);
  }
  /** The backend never answered. The relay uses the same codes, so screens read both alike. */
  static unreachable(error: unknown): ApiError {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return new ApiError({ statusCode: timedOut ? 504 : 502, code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
      message: "The service is unavailable. Please try again." });
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
```

```ts
// src/lib/server/fetch-server.ts
import "server-only";
import { cookies, headers as incoming } from "next/headers";
import { ApiError } from "@/lib/api/errors";
import { backendUrl } from "./backend-url";

export interface FetchServerOptions extends Omit<RequestInit, "body"> { body?: unknown; timeoutMs?: number }

/** Node sends no Origin. Forward the browser's, or a backend CSRF check refuses Server Action writes. */
async function browserOrigin(): Promise<Array<[string, string]>> {
  try {
    const from = await incoming();
    return ["origin", "referer"].flatMap((n): Array<[string, string]> => (from.has(n) ? [[n, from.get(n) ?? ""]] : []));
  } catch {
    return []; // no request (a build-time render): nothing to forward
  }
}

export async function fetchServer<T>(path: string, options: FetchServerOptions = {}): Promise<T> {
  const { body, method = "GET", timeoutMs = 15_000, headers: extra, ...rest } = options;
  const jar = await cookies();
  const headers = new Headers(extra);
  headers.set("accept", "application/json");
  headers.set("cookie", jar.toString()); // the session travels as cookies
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrf = jar.get("csrf_token")?.value; // your backend's cookie and header names
    if (csrf) {
      headers.set("x-csrf-token", csrf);
    }
    for (const [name, value] of await browserOrigin()) {
      headers.set(name, value);
    }
  }
  const json = body !== undefined && typeof body !== "string" && !(body instanceof FormData);
  if (json) {
    headers.set("content-type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(backendUrl(path), { ...rest, method, headers, redirect: "manual",
      body: json ? JSON.stringify(body) : (body as BodyInit | undefined),
      cache: rest.cache ?? "no-store", signal: rest.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw ApiError.unreachable(error); // a bare "fetch failed" carries the upstream host in its cause
  }
  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }
  // Unwrap your backend's success envelope here, once.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as { data: T }).data;
}
```

```ts
// src/lib/api/client-fetch.ts (the ONE browser caller; each domain's apis.ts uses it)
import { ApiError } from "./errors";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api"; // same-origin; inlined at build

function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (typeof init.body === "string") {
    headers.set("content-type", "application/json"); // FormData sets its own boundary
  }
  const csrf = /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie)?.[1];
  if (csrf && !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase())) {
    headers.set("x-csrf-token", decodeURIComponent(csrf));
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
}

export async function clientFetch<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const response = await send(path, init);
  if (!response.ok) {
    const error = await ApiError.fromResponse(response);
    if (!retried && error.status === 403 && error.code === "CSRF_TOKEN_INVALID") {
      await send("/auth/session", {}).catch(() => undefined); // any safe GET re-plants the cookie
      return clientFetch<T>(path, init, true);
    }
    throw error;
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as { data: T }).data;
}
```

## Traps

- When a session lapses, many calls 401 at once. Refresh ONCE for all of them (one shared promise): a refresh
  token redeemed twice looks like theft to many backends, and they end the session.
- Retry once, never in a loop. A refusal that survives the retry is real: show it.
- Never `"use cache"` a read that forwards the session cookie. It is per-user by definition.
- If the backend stores text HTML-escaped (`R&amp;D`), decode it once in these two callers, never per screen.
