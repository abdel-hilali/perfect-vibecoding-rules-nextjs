# Recipe: motion that is felt, not watched

## Problem

Decorative motion makes a work tool feel like a toy and slows every task down.
One retained transform at the top of a page once broke the position of every dialog below it.

## Rule

- 150 to 300 ms, purposeful: a motion explains a state change or a hierarchy (something arrived, opened, moved,
  is working) and runs ONCE. 400 ms only for a drawer or a sheet sliding in. Nothing bounces for attention,
  wiggles, counts up or draws itself. When in doubt, leave it plain.
- Tokens only: three durations and a few easings in `globals.css`, exported in `@theme inline`.
- Reduced motion = NONE. One base rule collapses every animation and transition. Motion driven from script asks a
  `usePrefersReducedMotion()` hook.
- Animate only opacity, scale, translate, rotate, box-shadow and colour. Use the individual `scale`, `translate`
  and `rotate` properties, never `transform`, never a layout property (width, height, top, left).
- Enters have no fill mode, or `backwards`. Only exits use `forwards`.
- No stagger cascades: things that land together land together.
- Loops only while a live state is true: a shimmer while loading, a spinner while busy, typing dots while someone
  types. They mount with the state and leave with it.
- One `animate-*` per element.

## Code

```css
/* src/app/globals.css (the motion part) */
:root {
  --motion-duration-short: 150ms;  /* colour, state, press, menu, exit */
  --motion-duration-medium: 300ms; /* dialog in, icon swap, a live item arriving */
  --motion-duration-long: 400ms;   /* drawer and sheet only */
  --motion-ease-standard: cubic-bezier(0.2, 0, 0, 1);         /* colour, exits */
  --motion-ease-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);  /* enters */
  --motion-ease-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);  /* dialog out */
}

@theme inline {
  --ease-standard: var(--motion-ease-standard);
  --ease-decelerate: var(--motion-ease-decelerate);
  /* A bare `transition` runs the house curve. */
  --default-transition-duration: var(--motion-duration-short);
  --default-transition-timing-function: var(--motion-ease-standard);
  /* Enters: NO fill mode, so nothing is retained after the motion. */
  --animate-dialog-in: dialog-in var(--motion-duration-medium) var(--motion-ease-decelerate);
  --animate-item-in: item-in var(--motion-duration-medium) var(--motion-ease-decelerate);
  /* Exits are the only `forwards`. */
  --animate-dialog-out: dialog-out var(--motion-duration-short) var(--motion-ease-accelerate) forwards;
  /* A loop: mount the element only while loading. */
  --animate-shimmer: shimmer 1.6s var(--motion-ease-standard) infinite;

  /* Individual properties: Tailwind v4's scale-* and translate-* set these too, so nothing fights over transform. */
  @keyframes dialog-in {
    from { opacity: 0; scale: 0.96; }
  }
  @keyframes dialog-out {
    to { opacity: 0; scale: 0.96; }
  }
  @keyframes item-in {
    from { opacity: 0; translate: 0 4px; }
  }
  @keyframes shimmer {
    from { translate: -100% 0; }
    to { translate: 100% 0; }
  }
}

@layer base {
  /* Reduced motion = none. 0.01ms, not 0: animationend and transitionend still fire. */
  @media (prefers-reduced-motion: reduce) {
    *,
    ::before,
    ::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      animation-delay: 0ms !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
```

```ts
// src/components/shared/motion/reduced-motion.ts (for motion CSS cannot reach: the Web Animations API)
"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
```

```tsx
// Usage: an enter, a press that respects reduced motion, and a loop mounted only with its state
export function MotionExamples({ loading, label }: { loading: boolean; label: string }) {
  return (
    <>
      <div role="dialog" aria-label={label} className="animate-dialog-in rounded-lg bg-background shadow-lg" />
      <button type="button" className="transition-[scale] active:scale-97 motion-reduce:active:scale-100">{label}</button>
      {loading ? (
        <div aria-hidden className="relative h-4 overflow-hidden rounded bg-muted">
          <span className="absolute inset-0 animate-shimmer bg-background/40" />
        </div>
      ) : null}
    </>
  );
}
```

## Traps

- A retained `translate` (an enter with `both` or `forwards`) makes its element the containing block of every
  `position: fixed` descendant. A page-level enter once pinned every dialog to the page frame instead of the
  viewport. Enters: no fill mode, or `backwards`.
- `tailwind-merge` keeps only the last `animate-*` of a class list. Two on one element means one is silently gone.
- Keyframes on `transform` fight Tailwind v4's `scale-*` and `translate-*` utilities. Use the individual properties.
- The CSS reduced-motion rule does not reach the Web Animations API or a JS timer. Ask the hook.
- `will-change` only on an element that exists only during the motion (a drag overlay), never on a resident one.
- jsdom never fires `animationend`: in unit tests, dispatch it yourself.
