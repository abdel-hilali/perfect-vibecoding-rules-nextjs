# Recipe: forms (react-hook-form + zod + a Server Action)

## Problem

Validation copied into components drifts from the schema, and every form starts to behave differently.
A Server Action is a public endpoint: the browser's validation proves nothing to the server.

## Rule

- The schema is the ONLY validator. It lives in `src/lib/apis/<domain>/form-schemas.ts` (zod), with
  `type X = z.infer<typeof schema>` beside it. Messages are i18n keys, translated by the form.
- Update schemas DERIVE from create (`.partial()`, `.pick()`, `.omit()`), never a hand-made copy.
- The form uses react-hook-form with `zodResolver(schema)` and `noValidate`: the schema decides, not the browser.
- The Server Action (`actions.ts`, `"use server"`): validate with the same schema, authorize, call the backend
  through `fetchServer` with only documented, filled keys, revalidate, and RETURN a typed result.
- After success, reset the form from the RESPONSE, not from what was typed: the backend may trim or normalize.

## Code

```ts
// src/lib/apis/invoices/form-schemas.ts
import { z } from "zod";

/** The shared field set. Create and update both derive from it. */
const invoiceFields = z.object({
  title: z.string().trim().min(2, { message: "validation.tooShort" }).max(120, { message: "validation.tooLong" }),
  amount: z.number({ message: "validation.number" }).positive({ message: "validation.positive" }),
  note: z.string().trim().max(500, { message: "validation.tooLong" }).optional(),
});

export const createInvoiceSchema = invoiceFields;
export const updateInvoiceSchema = invoiceFields.partial();
export const renameInvoiceSchema = invoiceFields.pick({ title: true });
export type CreateInvoiceValues = z.infer<typeof createInvoiceSchema>;
```

```ts
// src/lib/actions/run-action.ts (declared once; every domain's actions use it)
import "server-only";
import { canAccess, type AccessGate, type Principal } from "@/lib/access/can-access";
import { getPrincipal } from "@/lib/access/guards";
import { isApiError } from "@/lib/api/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; status: number; message: string; fieldErrors?: Record<string, string> };

export function invalid(issues: { path: PropertyKey[]; message: string }[]): ActionResult<never> {
  const fieldErrors = Object.fromEntries(issues.map((issue) => [issue.path.join("."), issue.message]));
  return { ok: false, code: "VALIDATION", status: 400, message: "", fieldErrors };
}

/** A Server Action is public: re-check here even though the page and <Gate> already did. */
export async function runAction<T>(gate: AccessGate, run: (p: Principal) => Promise<T>): Promise<ActionResult<T>> {
  const principal = await getPrincipal();
  if (!principal || !canAccess(gate, principal)) {
    return { ok: false, code: principal ? "FORBIDDEN" : "UNAUTHENTICATED", status: principal ? 403 : 401, message: "" };
  }
  try {
    return { ok: true, data: await run(principal) };
  } catch (error) {
    if (isApiError(error)) {
      return { ok: false, code: error.code, status: error.status, message: error.message };
    }
    throw error; // a bug, or a redirect() in flight: never turn it into a refusal
  }
}
```

```ts
// src/lib/apis/invoices/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { invalid, runAction, type ActionResult } from "@/lib/actions/run-action";
import { fetchServer } from "@/lib/server/fetch-server";
import { createInvoiceSchema, type CreateInvoiceValues } from "./form-schemas";
import type { Invoice } from "./types";

const FIELDS = ["title", "amount", "note"] as const;

export async function createInvoiceAction(input: CreateInvoiceValues): Promise<ActionResult<Invoice>> {
  const parsed = createInvoiceSchema.safeParse(input); // never trust the browser's validation
  if (!parsed.success) {
    return invalid(parsed.error.issues);
  }
  const body = Object.fromEntries(FIELDS.filter((k) => parsed.data[k] !== undefined).map((k) => [k, parsed.data[k]]));
  return runAction({ area: "INVOICES", level: "CREATE" }, async () => {
    const invoice = await fetchServer<Invoice>("/invoices", { method: "POST", body });
    revalidatePath("/[locale]/invoices", "page");
    return invoice;
  });
}
```

```tsx
// src/components/invoices/invoice-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createInvoiceAction } from "@/lib/apis/invoices/actions";
import { createInvoiceSchema, type CreateInvoiceValues } from "@/lib/apis/invoices/form-schemas";

type Copy = { title: string; amount: string; save: string; saved: string; messages: Record<string, string> };

export function InvoiceForm({ copy }: { copy: Copy }) {
  const router = useRouter();
  const { register, handleSubmit, setError, reset, formState: { errors, isSubmitting } } = useForm<CreateInvoiceValues>({
    resolver: zodResolver(createInvoiceSchema),
  });
  const say = (key?: string) => (key ? (copy.messages[key] ?? copy.messages.unexpected) : null);
  const onSubmit = handleSubmit(async (values) => {
    const result = await createInvoiceAction(values);
    if (!result.ok) {
      const fields = Object.entries(result.fieldErrors ?? {});
      fields.forEach(([field, key]) => setError(field as keyof CreateInvoiceValues, { message: key }));
      if (fields.length === 0) {
        setError("root", { message: result.code }); // branch on the code, never on the message
      }
      return;
    }
    reset({ title: result.data.title, amount: result.data.amount, note: result.data.note ?? undefined });
    toast.success(copy.saved);
    router.refresh();
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root ? <p role="alert" className="text-destructive">{say(errors.root.message)}</p> : null}
      <label className="block">{copy.title}
        <input {...register("title")} aria-invalid={Boolean(errors.title)} className="block w-full" />
      </label>
      {errors.title ? <p className="text-sm text-destructive">{say(errors.title.message)}</p> : null}
      <label className="block">{copy.amount}
        <input type="number" step="0.01" {...register("amount", { valueAsNumber: true })} className="block w-full" />
      </label>
      {errors.amount ? <p className="text-sm text-destructive">{say(errors.amount.message)}</p> : null}
      <button type="submit" disabled={isSubmitting} className="rounded-full bg-primary px-4 py-2 text-primary-foreground">
        {copy.save}
      </button>
    </form>
  );
}
```

## Traps

- zod 4 THROWS when you call `.partial()`, `.pick()` or `.omit()` on an object that has a refinement. Keep the
  plain field object, derive first, and add `.superRefine()` LAST on each derived schema.
- zod runs every check, even after a regex failed: guard a refinement that throws on bad input (`toISOString()`).
- `redirect()` throws: a catch-all around it turns it into an error. Rethrow anything that is not an `ApiError`.
- In production a thrown error reaches the client as a generic message plus a digest. Return refusals as values.
- An empty optional field: decide per field whether it sends `null` (clear the value) or nothing (keep it).
- A `.transform()` makes input and output types differ: `useForm<z.input<typeof s>, unknown, z.output<typeof s>>`.
