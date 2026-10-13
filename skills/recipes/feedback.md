# Recipe: feedback surfaces (one toaster; loading, error, not-found)

## Problem

Several toast systems, hand-made spinners and raw error screens make an app feel stitched together.
A segment without `loading.tsx` blocks on its slowest read; one without `error.tsx` shows the framework's page.

## Rule

- ONE toaster (sonner's `<Toaster>`), mounted ONCE in the layout that wraps every surface calling `toast()`.
  All feedback goes through `toast()`, `toast.success()`, `toast.error()`.
- Its look comes from theme tokens: `toastOptions={{ unstyled: true, classNames }}`, never `richColors`.
- Every route segment ships `loading.tsx` (a token-styled skeleton) and `error.tsx`; add `not-found.tsx` where a
  lookup can miss, and call `notFound()` when the read comes back empty.
- Messages come from the catalogs (`i18n.md`). Branch on the error `code`, never on its `message`.

## Code

```tsx
// src/app/[locale]/(app)/layout.tsx (the toaster part)
import type { ReactNode } from "react";
import { Toaster } from "sonner";

/** Role tokens only: the library's own skin is unlayered and would beat every utility. */
const TOAST_CLASSES = {
  toast:
    "flex w-(--width) items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground shadow-lg",
  title: "font-medium",
  description: "mt-0.5 text-xs text-muted-foreground",
  success: "[&>[data-icon]]:text-primary",
  error: "[&>[data-icon]]:text-destructive",
  actionButton: "rounded-full px-3 py-1 text-sm font-medium text-primary hover:bg-muted",
} as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" toastOptions={{ unstyled: true, classNames: TOAST_CLASSES }} />
    </>
  );
}
```

```tsx
// src/app/[locale]/(app)/invoices/loading.tsx
export default function InvoicesLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
      {Array.from({ length: 4 }, (_, row) => (
        <div key={row} className="h-12 w-full animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
```

```tsx
// src/app/[locale]/(app)/error.tsx
"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import enCommon from "@messages/en/common.json";
import frCommon from "@messages/fr/common.json";
import { resolveLocale } from "@/lib/i18n/config";

// A Client Component cannot load the server-only dictionary: import the small common catalog.
const COMMON = { en: enCommon, fr: frCommon };

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const copy = COMMON[resolveLocale(useParams()?.locale)].errors.page;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md space-y-3 rounded-lg border border-border bg-background p-6">
      <h1 className="text-xl font-semibold">{copy.title}</h1>
      <p className="text-muted-foreground">{copy.body}</p>
      {/* In production the digest is all the boundary gets: it is the support reference. */}
      {error.digest ? <p className="text-xs text-muted-foreground">{copy.reference} {error.digest}</p> : null}
      <button type="button" onClick={reset} className="rounded-full bg-primary px-4 py-2 text-primary-foreground">
        {copy.retry}
      </button>
    </div>
  );
}
```

```ts
// src/lib/server/fetch-server.ts (add beside fetchServer, see server-fetch.md)
/** For a lookup that may miss: a 404, and only a 404, becomes null. Everything else still throws. */
export async function fetchServerOrNull<T>(path: string, options?: FetchServerOptions): Promise<T | null> {
  return fetchServer<T>(path, options).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  });
}
```

```tsx
// src/app/[locale]/(app)/invoices/[id]/page.tsx (a lookup that can miss)
import { notFound } from "next/navigation";
import { InvoiceDetail } from "@/components/invoices/invoice-detail";
import { requireAccess } from "@/lib/access/guards";
import type { Invoice } from "@/lib/apis/invoices/types";
import { fetchServerOrNull } from "@/lib/server/fetch-server";

export default async function InvoicePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requireAccess(locale, "INVOICES");
  const invoice = await fetchServerOrNull<Invoice>(`/invoices/${encodeURIComponent(id)}`);
  if (!invoice) {
    notFound(); // renders the nearest not-found.tsx
  }
  return <InvoiceDetail invoice={invoice} />;
}
```

```ts
// In a Client Component, after a Server Action (the copy comes from the catalogs)
if (result.ok) {
  toast.success(copy.saved);
} else {
  toast.error(copy.messages[result.code] ?? copy.messages.unexpected); // the code, never the message
}
```

## Traps

- A toast library's runtime CSS is unlayered, so it beats Tailwind's `@layer utilities`: your classes seem
  ignored. Its built-in colours are hard-coded and ignore the theme. Use the unstyled mode with token classes.
- Never put an `animate-*` class on a toast: the library animates with transforms and the two would fight.
- In production an error boundary receives only `digest`: the message is stripped. If one failure has a known
  answer (rate limited: retry in N seconds), set the thrown error's `digest` to say so on the server, and parse it here.
- `not-found.tsx` and `forbidden.tsx` receive no `params`: read the locale from the locale cookie.
- A `loading.tsx` makes its segment stream. A `redirect()` thrown below it becomes a 200 plus a meta refresh.
- A link's default prefetch renders a route down to its first `loading.tsx`. Keep costly or side-effect reads in the
  page body below that boundary, never in a layout above it.
- Choose the toast position so it never covers a live control (a side panel's action, the top bar's buttons).
