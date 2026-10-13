# Recipe: SEO (one metadata builder per page)

## Problem

Hand-rolled metadata drifts: pages ship with no title, or six screens share one browser-tab title.
Two locales serving one page without `alternates` read to a crawler as duplicate content.

## Rule

- ONE builder, `buildPageMetadata()` in `src/lib/seo/`. Every `page.tsx` exports `generateMetadata` that calls it
  with a translated title and description, the path WITHOUT the locale, and the locale.
- It sets `metadataBase` from `NEXT_PUBLIC_SITE_URL` (when set), the canonical URL, one `hreflang` alternate per
  locale plus `x-default`, and Open Graph basics.
- Signed-in pages are `noIndex`: a crawler cannot sign in, so all it could index is a redirect.
- `robots.ts` disallows `/api/` and the app pages. `sitemap.ts` lists only public pages, once per locale, and
  returns an empty list when no site URL is configured.
- The edge proxy matcher excludes `robots.txt` and `sitemap.xml`, so they are served without a locale redirect.

## Code

```ts
// src/lib/seo/build-page-metadata.ts
import type { Metadata } from "next";
import { defaultLocale, locales, type Locale } from "@/lib/i18n/config";

export interface PageMetadataInput {
  title: string;
  description?: string;
  path: string; // without the locale, e.g. "/invoices"
  locale: Locale;
  noIndex?: boolean; // every signed-in page
}

function siteUrl(): URL | undefined {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? ""); // absent in development: relative URLs
  } catch {
    return undefined; // a malformed origin must not take a page down over its <link> tags
  }
}

export function buildPageMetadata({ title, description, path, locale, noIndex = false }: PageMetadataInput): Metadata {
  const clean = path === "/" ? "" : `/${path.replace(/^\/+/, "")}`;
  const languages: Record<string, string> = { "x-default": `/${defaultLocale}${clean}` };
  for (const other of locales) {
    languages[other] = `/${other}${clean}`;
  }
  return {
    title,
    description,
    metadataBase: siteUrl(),
    alternates: { canonical: `/${locale}${clean}`, languages },
    robots: noIndex ? { index: false, follow: false } : undefined,
    openGraph: { title, description, locale, type: "website" },
  };
}
```

```tsx
// src/app/[locale]/(app)/invoices/page.tsx (the metadata part)
import type { Metadata } from "next";
import { resolveLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildPageMetadata } from "@/lib/seo/build-page-metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const { invoices } = await getDictionary(locale);
  return buildPageMetadata({ ...invoices.metadata, path: "/invoices", locale, noIndex: true });
}
```

```ts
// src/app/robots.ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  return {
    // List app pages by path: the locale segment comes first, so there is no common prefix.
    rules: { userAgent: "*", allow: ["/"], disallow: ["/api/", "/*/dashboard", "/*/invoices", "/*/settings"] },
    ...(site ? { sitemap: `${site}/sitemap.xml` } : {}),
  };
}
```

```ts
// src/app/sitemap.ts
import type { MetadataRoute } from "next";
import { locales } from "@/lib/i18n/config";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/terms", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (!site) {
    return []; // a relative URL is not valid in a sitemap: better empty than wrong
  }
  return PUBLIC_PATHS.flatMap((path) =>
    locales.map((locale) => ({
      url: `${site}/${locale}${path}`,
      alternates: { languages: Object.fromEntries(locales.map((other) => [other, `${site}/${other}${path}`])) },
    })),
  );
}
```

## Traps

- A page whose URL carries a credential (a share link, a one-time token) must never be indexed or cached: send
  `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for that path, for the
  localized AND the unlocalized spelling (the locale redirect carries the token in its `Location`).
- Never list such pages in the sitemap.
- A trailing slash on the site URL produces `//` in every canonical URL. The env check refuses it.
- A page without `generateMetadata` inherits the layout's title: many screens end up sharing one tab title.
- Put metadata strings in the catalogs (`metadata.json` or the page's file), never as literals in the page.
