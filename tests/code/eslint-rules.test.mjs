// Checks scripts/eslint-rules.mjs without ESLint: the exports, the limits and
// the theme patterns. Usage: node eslint-rules.test.mjs <path to eslint-rules.mjs>
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node eslint-rules.test.mjs <path to eslint-rules.mjs>");
  process.exit(2);
}
const mod = await import(pathToFileURL(file).href);
const { sizeLimits, themeRules, hygieneRules, typeImportRules, wrapperRules, selectors, patterns } = mod;
const ALL = [...sizeLimits, ...themeRules, ...hygieneRules, ...typeImportRules, ...wrapperRules];
const GENERATED = "src/components/ui/**";
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}: ${error.message}`);
  }
};

const block = (name) => ALL.find((b) => b.name === name);
const max = (name, rule) => block(name).rules[rule][1].max;
const level = (name, rule) => block(name).rules[rule][0];

check("default export is [...sizeLimits, ...themeRules, ...hygieneRules]", () => {
  assert.deepEqual(mod.default, [...sizeLimits, ...themeRules, ...hygieneRules]);
});
check("every block has a name and a files list", () => {
  for (const b of ALL) {
    assert.ok(typeof b.name === "string" && Array.isArray(b.files), JSON.stringify(b.name));
  }
});
check("a source file 300 lines, any other function 60", () => {
  assert.equal(max("code-rules/size/source", "max-lines"), 300);
  assert.equal(max("code-rules/size/source", "max-lines-per-function"), 60);
});
check("a component function 190", () => assert.equal(max("code-rules/size/component", "max-lines-per-function"), 190));
check("a lib/utils/helpers function 50", () => {
  assert.equal(max("code-rules/size/lib", "max-lines-per-function"), 50);
  assert.match(block("code-rules/size/lib").files.join(), /lib,utils,helpers/);
});
check("a hook 60, after the lib block", () => {
  assert.equal(max("code-rules/size/hook", "max-lines-per-function"), 60);
  const names = sizeLimits.map((b) => b.name);
  assert.ok(names.indexOf("code-rules/size/hook") > names.indexOf("code-rules/size/lib"));
});
check("an API route file 150 and 50 per function, as errors", () => {
  assert.equal(max("code-rules/size/api-route", "max-lines"), 150);
  assert.equal(max("code-rules/size/api-route", "max-lines-per-function"), 50);
  assert.equal(level("code-rules/size/api-route", "max-lines"), "error");
});
check("a test file 400, no per-function limit, last", () => {
  assert.equal(max("code-rules/size/test", "max-lines"), 400);
  assert.equal(block("code-rules/size/test").rules["max-lines-per-function"], "off");
  assert.equal(sizeLimits.at(-1).name, "code-rules/size/test");
});
check("the project's scripts/ folder is exempt from size, theme and hygiene rules", () => {
  const scoped = (x) => x.files.join().includes("app/") || x.name.endsWith("/generated") || x.name.endsWith("/tests");
  for (const b of ALL.filter((x) => !scoped(x))) {
    assert.ok((b.ignores ?? []).includes("scripts/**"), b.name);
  }
});
check("generated primitives (src/components/ui/) are exempt from the size limits and the theme rules", () => {
  for (const b of [...sizeLimits.filter((x) => x.name !== "code-rules/size/api-route"), block("code-rules/theme")]) {
    assert.ok((b.ignores ?? []).includes(GENERATED), b.name);
  }
});
check("generated primitives keep the wrapper bans, without the theme bans", () => {
  const generated = block("code-rules/wrappers/generated");
  assert.deepEqual(generated.files, [GENERATED]);
  assert.deepEqual(generated.rules["no-restricted-syntax"], ["error", ...selectors.rawElements]);
  const names = wrapperRules.map((b) => b.name);
  assert.ok(names.indexOf("code-rules/wrappers/generated") > names.indexOf("code-rules/wrappers"));
});
check("hygiene: curly all, eqeqeq, prefer-const, no duplicate imports, console.log warns", () => {
  const { rules } = block("code-rules/hygiene");
  assert.deepEqual(rules.curly, ["error", "all"]);
  assert.deepEqual(rules.eqeqeq, ["error", "always"]);
  assert.equal(rules["prefer-const"], "error");
  assert.deepEqual(rules["no-duplicate-imports"], ["error", { allowSeparateTypeImports: true }]);
  assert.deepEqual(rules["no-console"], ["warn", { allow: ["warn", "error"] }]);
});
check("hygiene: console is allowed in tests (the tests block comes last)", () => {
  assert.equal(hygieneRules.at(-1).name, "code-rules/hygiene/tests");
  assert.equal(hygieneRules.at(-1).rules["no-console"], "off");
});
check("type-only imports are opt-in: a plugin rule, TypeScript files only, not in the default", () => {
  const [types] = typeImportRules;
  assert.deepEqual(types.rules["@typescript-eslint/consistent-type-imports"], ["error", { prefer: "type-imports" }]);
  assert.ok(types.files.every((f) => /ts/.test(f) && !/js/.test(f)), types.files.join());
  assert.ok(!mod.default.includes(types));
  for (const b of mod.default) {
    assert.ok(Object.keys(b.rules).every((rule) => !rule.includes("/")), `${b.name} needs a plugin`);
  }
});
check("blank lines and comments are not counted", () => {
  for (const b of sizeLimits) {
    for (const setting of Object.values(b.rules)) {
      if (Array.isArray(setting)) {
        assert.equal(setting[1].skipBlankLines, true);
        assert.equal(setting[1].skipComments, true);
      }
    }
  }
});

const banned = (text) =>
  [patterns.darkVariant, patterns.paletteColour, patterns.plainColour, patterns.arbitraryColour].some((p) => new RegExp(p).test(text));
const BAD = [
  "dark:bg-surface", "p-2 md:dark:text-foreground", "bg-white", "text-black", "bg-white/80", "text-zinc-600",
  "hover:border-slate-200", "border-t-gray-200", "from-black/50", "bg-[#fff]", "text-[rgb(0,0,0)]", "ring-offset-blue-500",
  "fill-red-500", "rounded bg-emerald-50 p-4",
];
const GOOD = [
  "bg-background", "text-foreground", "text-on-surface", "border-outline-variant", "bg-primary text-on-primary",
  "bg-background/80", "darkness", "data-white", "bg-surface-container", "shadow-e1", "ring-ring", "text-sm font-medium",
];
for (const text of BAD) check(`bans "${text}"`, () => assert.ok(banned(text)));
for (const text of GOOD) check(`allows "${text}"`, () => assert.ok(!banned(text)));

check("no selector regex contains a slash (the selector parser ends a regex there)", () => {
  for (const { selector } of [...selectors.theme, ...selectors.serverPage, ...selectors.rawElements]) {
    const regex = /=\/(.*)\/\]$/.exec(selector);
    if (regex) assert.ok(!regex[1].includes("/"), selector);
  }
});
check("the page/layout block carries the theme bans too", () => {
  const rule = block("code-rules/theme+server-page").rules["no-restricted-syntax"];
  assert.equal(rule.length, 1 + selectors.theme.length + selectors.serverPage.length);
});
check("wrapperRules repeat the theme bans and spare the wrapper folder", () => {
  const wrappers = block("code-rules/wrappers");
  assert.equal(wrappers.rules["no-restricted-syntax"].length, 1 + selectors.theme.length + selectors.rawElements.length);
  assert.ok(wrappers.ignores[0].endsWith("/overrides/**"));
  const names = wrappers.rules["no-restricted-imports"][1].paths.map((p) => p.name);
  assert.ok(names.includes("next/image") && names.includes("next/link"));
});

console.log(failed === 0 ? "eslint-rules: all checks passed" : `eslint-rules: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
