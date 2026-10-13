# Recipe: media and link wrappers

## Problem

User data is full of optional, broken or unsafe URLs, and a raw `<img>` turns each one into a broken graphic.
Raw `<a>` and `next/link` scattered through the app forget the locale, `rel` and the other rules.

## Rule

- Render media and links only through wrappers in `src/components/overrides/`: `AppImage`, `AppVideo`,
  `AppAvatar`, `AppLink` (internal, locale-aware) and `AppAnchor` (external).
- Every media URL goes through ONE pure, tested `resolveMediaUrl()` in `src/lib/media/`. It decides: remote,
  local, pdf, or placeholder. An `http:` URL becomes a placeholder. No host is written in it.
- Lint bans `next/image`, `next/link`, raw `<img>` and raw `<a>` outside `src/components/overrides/`.
- `images.remotePatterns` in `next.config.ts` is an explicit allowlist of real media hosts. Never a wildcard,
  never `http:`.
- A fallback tile uses tokens (`bg-muted text-muted-foreground`), never a hard-coded grey.

## Code

```ts
// src/lib/media/resolve-url.ts
export type MediaSource =
  | { kind: "remote" | "local" | "pdf"; src: string }
  | { kind: "placeholder"; src: null };

const LOCAL = ["/images/", "/icons/"];
const UPSTREAM_FILES = "/api/v1/files/"; // example: the upstream path your backend puts in file URLs (adjust)
export const FILE_RELAY = "/api/files/download/"; // our same-origin relay for it

export function resolveMediaUrl(url?: string | null): MediaSource {
  const raw = url?.trim() ?? "";
  const lower = raw.toLowerCase();
  let src: string | null = null;
  let kind: "remote" | "local" = "local";
  if (LOCAL.some((prefix) => raw.startsWith(prefix))) {
    src = raw;
  } else if (raw.startsWith(UPSTREAM_FILES) && raw.length > UPSTREAM_FILES.length) {
    // The browser cannot reach the upstream path: rewrite it to the relay, which carries the session.
    src = FILE_RELAY + encodeURIComponent(raw.slice(UPSTREAM_FILES.length));
  } else if (lower.startsWith("https://") || lower.startsWith("data:") || lower.startsWith("blob:")) {
    src = raw;
    kind = "remote";
  }
  if (src === null) {
    return { kind: "placeholder", src: null }; // empty, http:, protocol-relative or unknown
  }
  return { kind: raw.split(/[?#]/)[0].toLowerCase().endsWith(".pdf") ? "pdf" : kind, src };
}
```

```tsx
// src/components/overrides/app-image.tsx (a Server Component: zero client JavaScript)
import Image, { type ImageProps } from "next/image";
import { FILE_RELAY, resolveMediaUrl } from "@/lib/media/resolve-url";

type AppImageProps = Omit<ImageProps, "src"> & { src?: string | null };

export function AppImage({ src, alt, ...rest }: AppImageProps) {
  const media = resolveMediaUrl(src);
  if (media.kind === "remote" || media.kind === "local") {
    // The optimizer fetches server-side without cookies: a session-protected file must skip it.
    const unoptimized = rest.unoptimized ?? (media.src.startsWith(FILE_RELAY) || /^(data|blob):/i.test(media.src));
    return <Image {...rest} src={media.src} alt={alt} unoptimized={unoptimized} />;
  }
  return (
    <div role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
      style={rest.fill ? undefined : { width: Number(rest.width) || undefined, height: Number(rest.height) || undefined }}
      className="flex items-center justify-center bg-muted text-muted-foreground" />
  );
}
```

```ts
// src/lib/i18n/locale-path.ts (directive-free, so Server Components can call it too)
import { isLocale, type Locale } from "./config";

/** `/settings` -> `/en/settings`. Leaves absolute URLs, `/api/*`, files and localized paths alone. */
export function withLocalePrefix(href: string, locale: Locale): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/") || href.startsWith("/_next/")) {
    return href;
  }
  const first = href.slice(1).split(/[/?#]/)[0];
  if (first.includes(".") || isLocale(first)) {
    return href;
  }
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}
```

```tsx
// src/components/overrides/app-link.tsx (internal links)
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ComponentProps } from "react";
import { resolveLocale, type Locale } from "@/lib/i18n/config";
import { withLocalePrefix } from "@/lib/i18n/locale-path";

type AppLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string; locale?: Locale };

export function AppLink({ href, locale, ...rest }: AppLinkProps) {
  const params = useParams(); // every render calls the hook; a hook never sits behind `??`
  const active = locale ?? resolveLocale(params?.locale);
  return <Link {...rest} href={withLocalePrefix(href, active)} />;
}
```

```tsx
// src/components/overrides/app-anchor.tsx (external links: a new tab that cannot reach back)
import type { AnchorHTMLAttributes } from "react";

export function AppAnchor({ href, rel, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  if (rest.download !== undefined || /^(mailto|tel):/i.test(href)) {
    return <a {...rest} href={href} rel={rel} />; // handed to the OS or the download manager
  }
  const safeRel = [...new Set([...(rel ?? "").split(/\s+/).filter(Boolean), "noopener", "noreferrer"])].join(" ");
  return <a {...rest} href={href} target="_blank" rel={safeRel} />;
}
```

```ts
// next.config.ts (the images part)
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "media.example.com", pathname: "/uploads/**" }] },
};
export default nextConfig;
```

## Traps

- `next/image`'s optimizer fetches the source itself, server-side, with no cookie. A session-protected file
  comes back 401 and the page gets `400 "isn't a valid image"`. Mark such sources `unoptimized`.
- `priority` is deprecated in Next 16. Use `preload` on the one LCP image and set `sizes` on responsive ones.
- A wildcard `remotePatterns` turns your server into an open image proxy for any URL on the internet.
- A bare `href="/settings"` leaves the locale and pays a redirect through the edge proxy. `AppLink` prefixes it.
- Keep pure helpers (`withLocalePrefix`) out of `"use client"` files: there they become client references,
  and a Server Component calling one fails at runtime.
- Never an `AppLink` to `/api/*`: its prefetch calls the relay. A download is `AppAnchor` with `download`.
