/**
 * ESLint flat-config blocks for the code rules in docs/RULES.md.
 *
 *   sizeLimits       max-lines and max-lines-per-function, in counted lines
 *   themeRules       no `dark:` variant and no raw palette colour; also no
 *                    "use client" in a page or layout file
 *   hygieneRules     braces on every block, ===, prefer-const, no duplicate
 *                    imports, console.log warns (off in tests); core rules only
 *   typeImportRules  opt-in: `import type` for types. It needs the
 *                    @typescript-eslint plugin, which eslint-config-next/typescript
 *                    registers: spread it after that config
 *   wrapperRules     opt-in: no next/image, next/link, raw <img> or <a> outside
 *                    the wrapper folder (add it once the wrappers exist)
 *   default          [...sizeLimits, ...themeRules, ...hygieneRules]
 *
 * Use, in eslint.config.mjs, AFTER the framework's own config:
 *
 *   import codeRules, { typeImportRules, wrapperRules } from "./scripts/eslint-rules.mjs";
 *   export default [...nextConfig, ...codeRules, ...typeImportRules, ...wrapperRules];
 *
 * Size limits are warnings, so an old oversized file does not block the whole
 * lint. Run `eslint --max-warnings=0 <files you changed>` while working: new
 * code then fails the moment it grows past a limit. Route files are errors.
 *
 * Generated primitives in src/components/ui/ are exempt from the theme rules
 * and the size limits: a generator writes them and nobody edits them by hand.
 *
 * ESLint keeps only the LAST `no-restricted-syntax` setting that matches a
 * file. So every block below that sets it carries all the selectors that file
 * needs, and `wrapperRules` repeats the theme selectors. If the project adds
 * its own selectors, merge them with the exported `selectors` lists into one
 * setting, placed last.
 *
 * No dependencies: plain objects and regular expressions.
 */

/* -- Configuration ---------------------------------------------------------- */

const SIZE_LEVEL = "warn"; // "error" in a project with no oversized file left
const WRAPPERS_DIR = "src/components/overrides";
// The rules hold the app's code. The project's tooling (these check scripts among it) is exempt.
const TOOLING = ["scripts/**"];
// Generated primitives are exempt from the theme rules and the size limits: never edited by hand,
// and their `dark:` classes work through `@custom-variant dark` in globals.css.
const GENERATED = ["src/components/ui/**"];

const SOURCE = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const TYPESCRIPT = ["**/*.{ts,tsx,mts,cts}"];
const COMPONENTS = ["**/*.{jsx,tsx}"];
const LIB = ["**/{lib,utils,helpers}/**/*.{js,mjs,cjs,ts,mts,cts}"];
const HOOKS = ["**/hooks/**/*.{js,jsx,ts,tsx}", "**/use-*.{js,jsx,ts,tsx}"];
const ROUTES = ["**/app/api/**/route.{js,ts}"];
const TESTS = [
  "**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "**/__tests__/**",
  "e2e/**",
  "tests/**",
];
const PAGES = ["**/app/**/{page,layout}.{js,jsx,ts,tsx}"];

/* -- Size limits ------------------------------------------------------------ */

const counted = { skipBlankLines: true, skipComments: true };
const maxLines = (max, level = SIZE_LEVEL) => [level, { max, ...counted }];
const maxPerFunction = (max, level = SIZE_LEVEL) => [level, { max, ...counted, IIFEs: true }];

const EXEMPT = [...TOOLING, ...GENERATED];

// Order matters: for a file matched by several blocks, the last one wins.
export const sizeLimits = [
  {
    name: "code-rules/size/source",
    files: SOURCE,
    ignores: EXEMPT,
    rules: { "max-lines": maxLines(300), "max-lines-per-function": maxPerFunction(60) },
  },
  { name: "code-rules/size/component", files: COMPONENTS, ignores: EXEMPT, rules: { "max-lines-per-function": maxPerFunction(190) } },
  { name: "code-rules/size/lib", files: LIB, ignores: EXEMPT, rules: { "max-lines-per-function": maxPerFunction(50) } },
  { name: "code-rules/size/hook", files: HOOKS, ignores: EXEMPT, rules: { "max-lines-per-function": maxPerFunction(60) } },
  {
    name: "code-rules/size/api-route",
    files: ROUTES,
    rules: { "max-lines": maxLines(150, "error"), "max-lines-per-function": maxPerFunction(50, "error") },
  },
  {
    name: "code-rules/size/test",
    files: TESTS,
    ignores: EXEMPT,
    rules: { "max-lines": maxLines(400), "max-lines-per-function": "off" },
  },
];

/* -- Theme: colours come from tokens only ----------------------------------- */

// Selector regexes may not contain "/" (the selector parser ends the regex there).
const PREFIX = "(text|bg|border(-[xytrblse])?|decoration|ring(-offset)?|divide|outline|from|via|to|fill|stroke|shadow|accent|caret|placeholder)";
const PALETTE = "(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";

export const patterns = {
  darkVariant: "(^|[\\s:])dark:[a-z[!-]",
  paletteColour: `(^|[^\\w-])${PREFIX}-${PALETTE}-[0-9]{2,3}\\b`,
  plainColour: `(^|[^\\w-])${PREFIX}-(white|black)\\b`,
  arbitraryColour: `(^|[^\\w-])${PREFIX}-\\[(#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\()`,
};

const THEME_MESSAGE =
  "Colours come from theme tokens (docs/RULES.md): use a token utility such as bg-background or text-foreground. If none fits, add a token to :root and .dark.";
const DARK_MESSAGE =
  "No `dark:` variant (docs/RULES.md): the token sheet already switches with the theme. For a non-colour value, branch on resolvedTheme in a client component.";

/** One rule for both plain strings and template-literal parts. */
const ban = (pattern, message) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
];

export const selectors = {
  theme: [
    ...ban(patterns.darkVariant, DARK_MESSAGE),
    ...ban(patterns.paletteColour, THEME_MESSAGE),
    ...ban(patterns.plainColour, THEME_MESSAGE),
    ...ban(patterns.arbitraryColour, THEME_MESSAGE),
  ],
  serverPage: [
    {
      selector: 'ExpressionStatement > Literal[value="use client"]',
      message:
        "A page or layout stays a Server Component (docs/RULES.md): move the interactive part into a client component and render it here. A client page cannot export metadata.",
    },
  ],
  rawElements: [
    { selector: "JSXOpeningElement[name.name='img']", message: "Use the image wrapper (AppImage), not a raw <img>." },
    { selector: "JSXOpeningElement[name.name='a']", message: "Use the link wrappers (AppLink, AppAnchor), not a raw <a>." },
  ],
};

export const themeRules = [
  {
    name: "code-rules/theme",
    files: SOURCE,
    ignores: EXEMPT,
    rules: { "no-restricted-syntax": ["error", ...selectors.theme] },
  },
  {
    name: "code-rules/theme+server-page",
    files: PAGES,
    rules: { "no-restricted-syntax": ["error", ...selectors.theme, ...selectors.serverPage] },
  },
];

/* -- Wrappers: media and links go through one folder (opt-in) --------------- */

export const wrapperRules = [
  {
    name: "code-rules/wrappers",
    files: SOURCE,
    ignores: [`${WRAPPERS_DIR}/**`, ...TOOLING],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next/image", message: "Use the image wrapper (AppImage)." },
            { name: "next/legacy/image", message: "Use the image wrapper (AppImage)." },
            { name: "next/link", message: "Use the link wrappers (AppLink, AppAnchor)." },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...selectors.theme, ...selectors.rawElements],
    },
  },
  // Generated primitives keep the wrapper bans, without the theme bans the block above repeats.
  {
    name: "code-rules/wrappers/generated",
    files: GENERATED,
    rules: { "no-restricted-syntax": ["error", ...selectors.rawElements] },
  },
  {
    name: "code-rules/wrappers+server-page",
    files: PAGES,
    ignores: [`${WRAPPERS_DIR}/**`],
    rules: {
      "no-restricted-syntax": ["error", ...selectors.theme, ...selectors.serverPage, ...selectors.rawElements],
    },
  },
];

/* -- Hygiene: the purity half of the size rule ------------------------------ */

// Core ESLint rules only, so they work beside any framework config.
export const hygieneRules = [
  {
    name: "code-rules/hygiene",
    files: SOURCE,
    ignores: TOOLING,
    rules: {
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      // `import type { A }` beside `import { b }` from the same module is fine.
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // A test that logs is a test explaining itself while it runs.
  { name: "code-rules/hygiene/tests", files: TESTS, rules: { "no-console": "off" } },
];

// Opt-in: the rule comes from the @typescript-eslint plugin. eslint-config-next/typescript registers it for
// TypeScript files; without that plugin ESLint stops with "could not find plugin".
export const typeImportRules = [
  {
    name: "code-rules/type-imports",
    files: TYPESCRIPT,
    ignores: TOOLING,
    rules: { "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }] },
  },
];

export default [...sizeLimits, ...themeRules, ...hygieneRules];
