# Recipe: automatic light and dark theme

## Problem

When each component picks its own dark colour, the app ends up with two palettes that drift apart.
One colour token missing from the dark block once gave a whole dark theme a white page.

## Rule

- Colours live only in tokens in `src/app/globals.css`, in layers:
  1. a role sheet of literal colours in `:root`, redefined wholesale in `.dark`;
  2. semantic aliases (`--background`, `--primary`, `--border`) declared ONCE with `var()`, so they flip by themselves;
  3. `@theme inline` exports them as Tailwind v4 utilities (`bg-background`, `text-foreground`).
- Components use token utilities only. A `dark:` variant and a raw palette colour (`bg-white`, `text-zinc-600`)
  are lint errors (`themeRules` in `scripts/eslint-rules.mjs`). No token fits? Add the token.
- Generated primitives in `src/components/ui/` are exempt from the theme rules and the size limits. They keep
  the generator's `dark:` classes, which follow the `.dark` class through `@custom-variant dark` in `globals.css`.
  Your own code never writes `dark:`.
- The switch is the `.dark` class on `<html>`, set by next-themes with `attribute="class"`,
  `defaultTheme="system"` and `enableSystem`. Its blocking script applies it before paint.
  Put `suppressHydrationWarning` on `<html>`. The choice persists in `localStorage`.
- A non-colour value that depends on the theme (which icon to show) branches on `resolvedTheme`, never `theme`.
- Every literal colour token in `:root` is also defined in `.dark`. `pnpm check:theme` enforces it.
- Gradients are utilities named `wash-*`, never `bg-*`.

## Code

```css
/* src/app/globals.css */
@import "tailwindcss";

/* Serves the `dark:` classes of the generated primitives in src/components/ui/. Your own code never writes `dark:`. */
@custom-variant dark (&:where(.dark, .dark *));

/* Layer 1: the role sheet. Literal colours, light values. */
:root {
  --surface: #ffffff;
  --on-surface: #18181b;
  --surface-muted: #f4f4f5;
  --on-surface-muted: #52525b;
  --brand: #2563eb;
  --on-brand: #ffffff;
  --outline: #e4e4e7;

  /* Layer 2: semantic aliases. Declared once; the role under them is what flips. */
  --background: var(--surface);
  --foreground: var(--on-surface);
  --muted: var(--surface-muted);
  --muted-foreground: var(--on-surface-muted);
  --primary: var(--brand);
  --primary-foreground: var(--on-brand);
  --border: var(--outline);
  --brand-wash: linear-gradient(135deg, color-mix(in oklab, var(--brand) 10%, transparent), transparent);
}

/* Layer 1 again, dark values. Every literal token of :root appears here too. */
.dark {
  --surface: #111113;
  --on-surface: #e4e4e7;
  --surface-muted: #1f1f23;
  --on-surface-muted: #a1a1aa;
  --brand: #60a5fa;
  --on-brand: #172554;
  --outline: #3f3f46;
}

/* Layer 3: export as utilities. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-border: var(--border);
}

/* Gradients are not a @theme namespace: declare them as utilities, named wash-*. */
@utility wash-brand {
  background-image: var(--brand-wash);
}
```

```tsx
// src/components/theme-provider.tsx (one client boundary; the root layout stays a Server Component)
"use client";
import type { ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
```

```tsx
// src/app/[locale]/layout.tsx (the parts that matter for the theme)
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import "../globals.css";

export default async function RootLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {props.children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

```tsx
// src/components/theme-toggle.tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function ThemeToggle({ labels }: { labels: { toLight: string; toDark: string } }) {
  const { resolvedTheme, setTheme } = useTheme();
  // false on the server and during hydration, true after: the server cannot know the stored choice.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? labels.toLight : labels.toDark;
  return (
    <button type="button" aria-label={label} title={label} onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid size-10 place-items-center rounded-full text-primary hover:bg-muted">
      {dark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
    </button>
  );
}
```

## Traps

- `theme === "dark"` is false on a dark OS: under the system default, `theme` is `"system"`. Read `resolvedTheme`.
- Rendering the real icon on the server causes a hydration mismatch. Render the light state until mounted.
- A literal token set only in `:root` is inherited by `.dark` unchanged: a white panel in the dark theme.
  `pnpm check:theme` catches it; run it after every token change.
- `tailwind-merge` (inside `cn()`) treats every `bg-*` class as one group. A gradient named `bg-brand-wash`
  silently deletes the `bg-background` beside it. Name gradients `wash-*`.
- CSS a library injects at runtime is unlayered and beats every Tailwind utility. Use the library's unstyled mode
  and token classes (see `feedback.md` for the toaster).
- Pin the colour scheme in E2E (`colorScheme: "light"`), or the runner's OS decides what the specs see.
