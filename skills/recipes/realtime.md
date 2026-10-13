# Recipe: realtime (typed socket manager with a REST fallback)

## Problem

A socket that each screen opens for itself multiplies connections and spends tokens twice.
Pushed events get lost on any hiccup, so a badge fed only by the socket shows a wrong number.

## Rule

- WebSockets cannot ride the Next relay. The browser connects to a deliberate public socket origin
  (`NEXT_PUBLIC_WEBSOCKET_URL`, also listed in the CSP `connect-src`).
- Authenticate with a SHORT-LIVED token exchanged server-side: the browser asks the same-origin relay, the relay
  forwards the HttpOnly session cookie upstream, and JavaScript never reads the session cookie.
- ONE typed manager per tab: a factory that throws on the server, created in the browser, started in an effect
  and stopped in its cleanup. Event names are typed `keyof` an event map. Mount it keyed by the user id.
- Frames are at-most-once. REST stays the truth: every pushed number is also fetchable over REST, and a surface
  refetches when the socket (re)connects and on `visibilitychange`. Poll fast while the socket is down, slowly
  (a safety net) while it is live.

## Code

```ts
// src/lib/realtime/socket-client.ts
import { io, type Socket } from "socket.io-client";
import { isApiError } from "@/lib/api/errors";

/** The typed contract, declared once. */
export interface ServerEvents { "notification.created": { id: string; title: string }; "invoice.updated": { id: string } }
export interface ClientEvents { "room.join": { room: string } }
export type RealtimeClient = ReturnType<typeof createRealtimeClient>;

/** The live flag, its watchers and the ONE retry loop: the library's own reconnection stays off. */
function createLink(current: () => Socket | null, mintToken: () => Promise<string>) {
  const watchers = new Set<() => void>();
  let live = false;
  let timer = 0;
  let attempt = 0;
  const backoff = () => Math.min(30_000, 1_000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
  const schedule = (ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void open(), ms);
  };
  async function open(): Promise<void> {
    const socket = current();
    if (!socket || socket.connected) {
      return;
    }
    try {
      socket.auth = { token: await mintToken() }; // single-use: one per attempt, never minted ahead
      if (current() === socket) {
        socket.connect();
      }
    } catch (error) {
      // A 429 says how long to wait. Retrying earlier only extends the lockout.
      schedule(isApiError(error) && error.retryAfterSeconds ? error.retryAfterSeconds * 1_000 : backoff());
    }
  }
  return {
    schedule,
    retry: () => schedule(backoff()),
    cancel: () => window.clearTimeout(timer),
    setLive(value: boolean) {
      live = value;
      attempt = value ? 0 : attempt; // a connection that opens resets the backoff
      watchers.forEach((watcher) => watcher());
    },
    // Closures, not `this`: both can be handed to useSyncExternalStore unbound.
    onStatus(watcher: () => void) {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    isLive: () => live,
  };
}

export function createRealtimeClient(origin: string, mintToken: () => Promise<string>) {
  if (typeof window === "undefined") {
    throw new Error("The realtime client is browser-only: create it in a Client Component.");
  }
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let socket: Socket | null = null;
  const link = createLink(() => socket, mintToken);
  return {
    start() {
      if (socket) {
        return;
      }
      // The ORIGIN plus the namespace only: Socket.IO reads any path as a namespace.
      socket = io(`${origin}/live`, { transports: ["websocket"], autoConnect: false, reconnection: false });
      socket.on("connect", () => link.setLive(true));
      socket.on("connect_error", () => link.retry()); // our backoff, never the library's
      socket.on("disconnect", (reason) => {
        link.setLive(false);
        if (reason !== "io client disconnect") {
          link.retry();
        }
      });
      socket.onAny((event: string, payload: unknown) => listeners.get(event)?.forEach((listener) => listener(payload)));
      link.schedule(0); // one tick late: React's development double mount stops before a token is spent
    },
    stop() {
      link.cancel();
      socket?.disconnect();
      socket = null;
      link.setLive(false);
    },
    on<E extends keyof ServerEvents>(event: E, listener: (payload: ServerEvents[E]) => void): () => void {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set.add(listener as (payload: unknown) => void));
      return () => set.delete(listener as (payload: unknown) => void);
    },
    emit<E extends keyof ClientEvents>(event: E, payload: ClientEvents[E]): boolean {
      if (!socket?.connected) {
        return false; // never buffered: a late frame could act on a stale state
      }
      socket.emit(event, payload);
      return true;
    },
    onStatus: link.onStatus,
    isLive: link.isLive,
  };
}
```

```tsx
// src/components/shared/realtime/realtime-provider.tsx (mount as <RealtimeProvider key={user.id}>)
"use client";

import { createContext, useEffect, useState, type ReactNode } from "react";
import { clientFetch } from "@/lib/api/client-fetch";
import { createRealtimeClient, type RealtimeClient } from "@/lib/realtime/socket-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL ?? "";
const mint = async () => (await clientFetch<{ token: string }>("/realtime/issue-token")).token;
export const RealtimeContext = createContext<RealtimeClient | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  // null on the server and when realtime is off: every surface keeps its REST poll.
  const [client] = useState(() =>
    typeof window === "undefined" || !SOCKET_URL ? null : createRealtimeClient(new URL(SOCKET_URL).origin, mint));
  useEffect(() => {
    client?.start();
    return () => client?.stop();
  }, [client]);
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}
```

The token route, `src/app/api/realtime/issue-token/route.ts`, is one line: `export const GET = proxy("/sockets/ticket");`.
A surface reads `useSyncExternalStore(client.onStatus, client.isLive, () => false)` to set its REST poll interval.

## Traps

- Mint the token from the BROWSER through the relay, not with the Next server's own fetch: some backends bind the
  token to the caller's `User-Agent` and silently refuse a handshake from another one.
- A mint budget is often per user. Remember a 429 cool-down per USER: `localStorage` is per origin, so one
  account's lockout would silence every other account in that browser.
- One 401 from the mint is not proof of a sign-out (a refresh may have timed out). Retry once; stop on the second.
- Turn off the library's own reconnection and run one backoff you control, or two retry loops spend tokens.
