// Lints small samples with the real ESLint, when one is installed nearby.
// Usage: node eslint-lint.test.mjs <path to eslint-rules.mjs>
// ESLINT_DIR may name a project folder whose node_modules holds ESLint 9.
// Exit 77 (skipped) when no ESLint can be found: the suite needs no network.
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node eslint-lint.test.mjs <path to eslint-rules.mjs>");
  process.exit(2);
}
let Linter;
try {
  ({ Linter } = createRequire(join(resolve(process.env.ESLINT_DIR ?? "."), "package.json"))("eslint"));
} catch {
  console.log("  skip no ESLint found (set ESLINT_DIR to a project folder that has it)");
  process.exit(77);
}
const { default: codeRules, wrapperRules, typeImportRules } = await import(pathToFileURL(file).href);
const CWD = "/project";
const linter = new Linter({ configType: "flat", cwd: CWD });
const base = [{ files: ["**/*.{js,jsx}"], languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } }];
const lint = (path, code, extra = []) =>
  linter.verify(code, [...base, ...codeRules, ...extra], { filename: `${CWD}/${path}` }).map((m) => `${m.ruleId}:${m.severity}`);

let failed = 0;
const expect = (name, path, code, wanted, extra) => {
  const got = lint(path, code, extra);
  const ok = wanted === null ? got.length === 0 : got.includes(wanted);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${JSON.stringify(got)})`}`);
  if (!ok) failed += 1;
};
const fn = (name, lines) => `export function ${name}() {\n${"  void 0;\n".repeat(lines - 2)}}\n`;
const comp = (lines) => `export function Card() {\n${"  void 0;\n".repeat(lines - 3)}  return <div className="bg-surface" />;\n}\n`;
const fileOf = (lines) => "void 0;\n".repeat(lines);

expect("raw palette colour in JSX is an error", "src/components/a/card.jsx", 'export const C = () => <div className="p-2 bg-white" />;', "no-restricted-syntax:2");
expect("dark: variant in a template literal is an error", "src/components/a/card.jsx", "export const c = `p-2 dark:bg-black`;", "no-restricted-syntax:2");
expect("token utilities pass", "src/components/a/card.jsx", 'export const C = () => <div className="bg-background text-on-surface" />;', null);
expect('"use client" in a page is an error', "src/app/projects/page.jsx", '"use client";\nexport default function P() { return null; }', "no-restricted-syntax:2");
expect("a page still gets the theme bans", "src/app/projects/page.jsx", 'export default function P() { return <div className="text-zinc-600" />; }', "no-restricted-syntax:2");
expect('"use client" in a component is fine', "src/components/a/card.jsx", '"use client";\nexport const C = () => null;', null);
expect("component function of 190 lines passes", "src/components/a/card.jsx", comp(190), null);
expect("component function of 191 lines warns", "src/components/a/card.jsx", comp(191), "max-lines-per-function:1");
expect("lib function of 50 lines passes", "src/lib/format.js", fn("format", 50), null);
expect("lib function of 51 lines warns", "src/lib/format.js", fn("format", 51), "max-lines-per-function:1");
expect("hook of 60 lines passes", "src/hooks/use-thing.js", fn("useThing", 60), null);
expect("hook of 61 lines warns", "src/hooks/use-thing.js", fn("useThing", 61), "max-lines-per-function:1");
expect("other function of 61 lines warns", "src/app/projects/data.js", fn("load", 61), "max-lines-per-function:1");
expect("source file of 301 lines warns", "src/app/projects/data.js", fileOf(301), "max-lines:1");
expect("route file of 151 lines is an error", "src/app/api/projects/list/route.js", fileOf(151), "max-lines:2");
expect("test file of 400 lines passes", "src/lib/format.test.js", fileOf(400), null);
expect("test file of 401 lines warns", "src/lib/format.test.js", fileOf(401), "max-lines:1");
expect("comments and blank lines do not count", "src/app/projects/data.js", `${fileOf(300)}\n\n// note\n/* more\n note */\n`, null);
expect("the scripts/ folder is exempt", "scripts/check-x.mjs", fileOf(400) + fn("main", 120), null);
expect("wrapperRules: raw <img> outside the wrappers is an error", "src/components/a/card.jsx", 'export const C = () => <img src="/a.png" alt="" />;', "no-restricted-syntax:2", wrapperRules);
expect("wrapperRules: next/link outside the wrappers is an error", "src/components/a/card.jsx", 'import Link from "next/link";\nexport { Link };', "no-restricted-imports:2", wrapperRules);
expect("wrapperRules: the wrapper folder may use <img>", "src/components/overrides/app-image.jsx", 'export const C = () => <img src="/a.png" alt="" />;', null, wrapperRules);
expect("wrapperRules: theme bans still apply", "src/components/a/card.jsx", 'export const C = () => <div className="bg-black" />;', "no-restricted-syntax:2", wrapperRules);

// Generated primitives: exempt from the theme rules and the size limits, not from the wrapper bans.
const generated = 'export const B = () => <button className="bg-destructive text-white dark:bg-input/30" />;';
expect("generated primitive: dark: and raw colours pass", "src/components/ui/button.jsx", generated, null);
expect("generated primitive: no size limit", "src/components/ui/sidebar.jsx", fileOf(400), null);
expect("generated primitive: wrapperRules add no theme ban", "src/components/ui/button.jsx", generated, null, wrapperRules);
expect("generated primitive: wrapperRules still ban a raw <a>", "src/components/ui/pagination.jsx", 'export const P = () => <a href="/x">x</a>;', "no-restricted-syntax:2", wrapperRules);

// Hygiene, the purity half of the size rule.
expect("an if without braces is an error", "src/lib/pick.js", "export function pick(a) {\n  if (a) return 1;\n  return 2;\n}\n", "curly:2");
expect("== is an error", "src/lib/pick.js", "export const same = (a, b) => a == b;\n", "eqeqeq:2");
expect("a let never reassigned is an error", "src/lib/pick.js", "let base = 1;\nexport { base };\n", "prefer-const:2");
expect("two imports from one module is an error", "src/lib/pick.js", 'import { a } from "./m.js";\nimport { b } from "./m.js";\nexport { a, b };\n', "no-duplicate-imports:2");
expect("console.log warns in app code", "src/lib/pick.js", "console.log(1);\n", "no-console:1");
expect("console.warn and console.error pass", "src/lib/pick.js", "console.warn(1);\nconsole.error(2);\n", null);
expect("console.log passes in a test", "src/lib/pick.test.js", "console.log(1);\n", null);

// typeImportRules need the TypeScript parser and plugin; run them when the project folder has both.
let ts = null;
try {
  const load = createRequire(join(resolve(process.env.ESLINT_DIR ?? "."), "package.json"));
  ts = { parser: load("@typescript-eslint/parser"), plugin: load("@typescript-eslint/eslint-plugin") };
} catch {
  console.log("  skip typeImportRules samples (no @typescript-eslint/parser and eslint-plugin found)");
}
if (ts) {
  const tsBase = { files: ["**/*.{ts,tsx}"], languageOptions: { parser: ts.parser, sourceType: "module" }, plugins: { "@typescript-eslint": ts.plugin } };
  const withTypes = [tsBase, ...typeImportRules];
  expect("typeImportRules: a value import used only as a type is an error", "src/lib/total.ts", 'import { Invoice } from "./types";\nexport const total = (i: Invoice) => i.amount;\n', "@typescript-eslint/consistent-type-imports:2", withTypes);
  expect("typeImportRules: import type beside a value import passes", "src/lib/total.ts", 'import type { Invoice } from "./types";\nimport { rate } from "./types";\nexport const total = (i: Invoice) => i.amount * rate;\n', null, withTypes);
}

console.log(failed === 0 ? "eslint lint: all checks passed" : `eslint lint: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
