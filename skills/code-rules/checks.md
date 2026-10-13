# Setting up the code checks

Five files in the project's `scripts/` folder enforce `docs/RULES.md`. None needs a dependency: Node 18+ and
the Python 3 standard library only. `eslint-rules.mjs` is a config module for ESLint. The four `check-*` scripts
exit 0 when clean, 1 on a problem and 2 on wrong arguments, and never need the network.

| File | Enforces | Run |
| --- | --- | --- |
| `scripts/eslint-rules.mjs` | size limits, theme bans, purity, no `"use client"` in pages and layouts (type imports and wrappers opt-in) | through ESLint |
| `scripts/check-structure.mjs` | domain files, relay routes, ids last, kebab-case, components mirror, client constants, file sizes | `pnpm check:structure` |
| `scripts/check-i18n.mjs` | catalog parity across locales, placeholders, curly apostrophes | `pnpm check:i18n` |
| `scripts/check-json-dupes.py` | invalid JSON and duplicate keys, recursive | `pnpm check:json` |
| `scripts/check-theme.mjs` | every literal colour in `:root` also in `.dark`; no literal colour in `@theme` | `pnpm check:theme` |

## 1. package.json scripts

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "check:structure": "node scripts/check-structure.mjs",
    "check:i18n": "node scripts/check-i18n.mjs",
    "check:json": "python3 scripts/check-json-dupes.py messages",
    "check:theme": "node scripts/check-theme.mjs",
    "verify": "pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm check:json && pnpm check:theme && pnpm check:structure && pnpm test"
  }
}
```

`lint` (`eslint`) and `test` (for example `vitest run`) are the project's own scripts.

Optional, for the coverage floor and the timezone run of R15 (`test:coverage` needs `@vitest/coverage-v8`; `test:tz`
needs a POSIX shell, so on Windows run it inside WSL):

```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage",
    "test:tz": "TZ=Pacific/Auckland vitest run"
  }
}
```

Once the project has them, `verify` ends with `pnpm test:coverage && pnpm test:tz` in place of `pnpm test`.

A check whose folder does not exist yet (`messages/`, `src/lib/apis/`, ...) prints a note and passes. It starts
to bite the day the folder appears, so a young project can wire all five on day one.

## 2. ESLint

Spread the rules AFTER the framework's own config, in `eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import codeRules, { typeImportRules, wrapperRules } from "./scripts/eslint-rules.mjs";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...codeRules,
  ...typeImportRules, // needs the @typescript-eslint plugin, which nextTs registers
  // ...wrapperRules, once src/components/overrides/ holds the image and link wrappers
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
```

- The default export holds the size limits, the theme bans and the purity rules (`hygieneRules`: `curly`,
  `eqeqeq`, `prefer-const`, `no-duplicate-imports`, `no-console` as a warning, off in tests). They are core ESLint
  rules, so they work beside any framework config. `typeImportRules` (`import type` for types) is a plugin rule:
  leave it out if the config has no `eslint-config-next/typescript` or typescript-eslint.
- Generated primitives in `src/components/ui/` are exempt from the theme rules and the size limits. The
  `wrapperRules` still hold them.
- Size limits are warnings so that one old file does not block the whole lint. Make them bite with
  `pnpm exec eslint --max-warnings=0 <changed files>` after every change. A project with no oversized file can
  set `SIZE_LEVEL = "error"` at the top of `eslint-rules.mjs`.
- ESLint keeps only the LAST `no-restricted-syntax` setting that matches a file. If the project has its own
  selectors, import the exported `selectors` lists, merge them into one setting and place it last:
  `"no-restricted-syntax": ["error", ...selectors.theme, ...mySelectors]`.
- A test that needs raw class names as data (a test of a class-merging helper): turn the rule off for that one
  file, with a comment saying why.

  ```js
  // Class names here are test data for the merge helper, not styling.
  { files: ["src/lib/utils.test.ts"], rules: { "no-restricted-syntax": "off" } },
  ```

- The wrapper folder is `src/components/overrides/`. If yours differs, change `WRAPPERS_DIR` at the top.

## 3. check-structure.mjs

Adjust the `CONFIG` block at the top of the file once. Paths are relative to the project root.

| Key | Default | Meaning |
| --- | --- | --- |
| `domainsDir`, `domainFiles` | `src/lib/apis`, the five files | one folder per backend domain, those files only (tests allowed) |
| `apiDir`, `routeFileNames`, `relayCall` | `src/app/api`, `route.ts`/`route.js`, `proxy(` | relay route files and the shared helper they call |
| `kebabDirs` | `src/components`, `src/lib`, `src/hooks` | folders whose file names must be kebab-case |
| `componentsDir`, `appDir`, `sharedComponentDirs` | `src/components`, `src/app`, `shared ui overrides` | the mirror: other top-level component folders must name a route segment |
| `sourceDir`, `aliases` | `src`, `@/` → `src/` | to follow imports for the client-constant check |
| `sizeRoots`, `maxLines` | `src e2e tests`, 300 / 400 / 150 | counted-line limits: source, test, route file |
| `generatedDirs` | `src/components/ui` | generated primitives: no size limit |
| `sizeExceptions` | empty | old files tolerated over the limit: `"path": "reason"` |

The line count matches ESLint's `max-lines` with `skipBlankLines` and `skipComments`. A `sizeExceptions` entry
is a debt with a reason, never a fix. The script reports an entry that is no longer needed.

## 4. check-i18n.mjs

- Reads the locales from `src/lib/i18n/config.ts`:
  `export const locales = ["en", "fr"] as const;` and `export const defaultLocale = "en";`.
  Without that file it compares the folders it finds, with `en` as the shape source.
- Change `messagesDir` or `localeConfig` at the top if your layout differs.
- ICU messages work: in `{count, plural, one {# item} other {# items}}` only `count` is a placeholder. A
  numbered placeholder (`{0}`) counts, and so does an argument inside a branch (`one {# item for {name}}`).
- Both curly apostrophes (‘ and ’) are flagged: the catalogs use the straight one (').

## 5. check-json-dupes.py and check-theme.mjs

- `python3 scripts/check-json-dupes.py <dir-or-file> [more ...]` walks folders recursively and prints each
  duplicate with its key path and line numbers. `NaN` and `Infinity` count as invalid JSON: Python reads them,
  `JSON.parse` does not.
- `node scripts/check-theme.mjs [css-file]` defaults to `src/app/globals.css`, then `app/globals.css`. It reads
  `:root` and `.dark` blocks anywhere, including inside `@layer` and `@media`. A value written with `var()` is an
  alias and needs no dark twin. A `:root` inside `@media (prefers-color-scheme: dark)` (the `create-next-app`
  starter) counts as the dark sheet, so a fresh app passes.
