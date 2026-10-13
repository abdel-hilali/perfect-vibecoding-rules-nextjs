# Recipe: filter bars where the URL is the state

## Problem

A filter bar built on client state cannot be shared, bookmarked or restored with Back.
Its state and the server's list drift, and the list re-fetches in ways nobody planned.

## Rule

- A filter bar is a plain `<form method="get">` rendered by a Server Component. Field names are query parameters.
  The URL is the single source of filter state.
- The page parses `searchParams` with a schema. Each field `.catch(undefined)` on its own, so one bad value drops
  that filter, not the page.
- A small client enhancer (`<LiveFilters />`) inside the form applies changes by itself with a SOFT replace
  (`router.replace(url, { scroll: false })`): selects on change, text after a pause, Enter intercepted.
- The Apply button stays in the markup as the no-JavaScript path; the enhancer hides it.
- Changing a filter drops the pagination cursor: it points into the old order.

## Code

```ts
// src/lib/apis/invoices/form-schemas.ts (the filter part)
import { z } from "zod";

export const invoiceFiltersSchema = z.object({
  q: z.string().trim().min(2).max(100).optional().catch(undefined),
  status: z.enum(["DRAFT", "SENT", "PAID"]).optional().catch(undefined),
  cursor: z.string().max(512).optional().catch(undefined),
});
export type InvoiceFilters = z.infer<typeof invoiceFiltersSchema>;

type Raw = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseInvoiceFilters(raw: Raw): InvoiceFilters {
  return invoiceFiltersSchema.parse({ q: first(raw.q), status: first(raw.status), cursor: first(raw.cursor) });
}
```

```tsx
// src/components/invoices/invoice-filters.tsx (a Server Component: a plain GET form)
import { LiveFilters } from "@/components/shared/form/live-filters";
import type { InvoiceFilters as Filters } from "@/lib/apis/invoices/form-schemas";

type Copy = { search: string; status: string; any: string; apply: string; statuses: Record<string, string> };

export function InvoiceFilters({ filters, copy }: { filters: Filters; copy: Copy }) {
  return (
    <form method="get" role="search" className="flex flex-wrap items-center gap-3">
      <input name="q" type="search" minLength={2} maxLength={100} defaultValue={filters.q ?? ""}
        aria-label={copy.search} placeholder={copy.search} />
      <select name="status" defaultValue={filters.status ?? ""} aria-label={copy.status}>
        <option value="">{copy.any}</option>
        {Object.entries(copy.statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {/* No cursor field: a new filter starts from the first page. */}
      <button type="submit">{copy.apply}</button>
      <LiveFilters />
    </form>
  );
}
```

```tsx
// src/components/shared/form/live-filters.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Applies the GET form it sits in. It keeps no state: FormData is the source, the URL the result. */
export function LiveFilters({ debounceMs = 400 }: { debounceMs?: number }) {
  const marker = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  const routerRef = useRef(router); // listeners must outlive re-renders, or a pending search is dropped
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      clearTimeout(timer);
      const params = new URLSearchParams();
      for (const [name, value] of new FormData(form)) {
        if (typeof value === "string" && value !== "") {
          params.set(name, value);
        }
      }
      const query = params.toString();
      const { pathname } = window.location;
      routerRef.current.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };
    const onChange = (event: Event) => {
      if (event.target instanceof HTMLSelectElement && event.target.name) {
        apply();
      }
    };
    const onInput = (event: Event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement) || !field.name) {
        return; // an unnamed field never reaches FormData: do not navigate for it
      }
      clearTimeout(timer);
      // Below its own minLength the server drops the filter: wait. Emptying it applies at once.
      if (field.value !== "" && field.value.trim().length < field.minLength) {
        return;
      }
      timer = setTimeout(apply, field.value === "" ? 0 : debounceMs);
    };
    const onSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      apply();
    };
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) {
      submit.hidden = true;
    }
    form.addEventListener("change", onChange);
    form.addEventListener("input", onInput);
    form.addEventListener("submit", onSubmit);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("change", onChange);
      form.removeEventListener("input", onInput);
      form.removeEventListener("submit", onSubmit);
      if (submit) {
        submit.hidden = false;
      }
    };
  }, [debounceMs]);

  return <span ref={marker} hidden />;
}
```

The page: `const filters = parseInvoiceFilters(await searchParams)`, then read the list with those filters and
render `<InvoiceFilters filters={filters} copy={dict.invoices.filters} />` above it.

## Traps

- React never re-applies a changed `defaultValue` to a mounted field, and Next does not remount a page on a
  query-only navigation. After Back or a "Clear" link a field can SHOW an old value and send it again. Render the
  applied value twice (`defaultValue` and `data-applied`) and make fields follow `data-applied`, except the
  focused one. Keying the form on the query instead remounts it and steals focus mid-typing.
- A one-letter search the server refuses renders an unfiltered list that LOOKS like a result. Hold it.
- Navigating on every keystroke floods history and the server: debounce, and use `replace`, not `push`.
- In E2E the soft replace lands a moment later: wait for the URL (`page.waitForURL`), never a fixed sleep.
