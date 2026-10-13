#!/usr/bin/env node
/**
 * Translation parity check: every locale ships the same catalogs as the
 * default one, with the same keys, value kinds and {placeholders}.
 *
 * Why a check and not a review habit: the failure is invisible. A key added
 * to the default catalog and forgotten in another renders "undefined" (or
 * throws) on a page nobody opened in that language.
 *
 * Checks:
 *   1. the locale folders in `messagesDir` match the locales the app declares
 *   2. the same set of .json files in every locale (sub-folders included)
 *   3. the same keys: missing AND extra are both reported
 *   4. the same value kind at every key (string, array, number, ...)
 *   5. the same {placeholders} in every string
 *   6. no curly apostrophe (‘ or ’): one apostrophe everywhere, the straight one ('),
 *      so a search or a test finds the text
 *
 * Duplicate keys are not visible here (JSON.parse keeps the last one):
 * scripts/check-json-dupes.py catches them.
 *
 * Usage: node scripts/check-i18n.mjs [project-dir]
 * No dependencies; Node 18 or newer.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";

/* -- Configuration: adjust to the project. Paths are relative to its root. -- */

const CONFIG = {
  messagesDir: "messages",
  // Declares `export const locales = ["en", "fr"]` and `export const defaultLocale = "en"`.
  localeConfig: "src/lib/i18n/config.ts",
  // Used when the locale config does not exist.
  fallbackDefaultLocale: "en",
};

const USAGE = "Usage: node scripts/check-i18n.mjs [project-dir]";
const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
if (args.length > 1 || (args[0] !== undefined && !isDir(resolve(args[0])))) {
  console.error(USAGE);
  process.exit(2);
}
const ROOT = resolve(args[0] ?? ".");
const MESSAGES = join(ROOT, CONFIG.messagesDir);
const errors = [];
const fail = (message) => errors.push(message);

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Locales read out of the config source: it is TypeScript, and this runs under bare node. */
function declaredLocales() {
  const file = join(ROOT, CONFIG.localeConfig);
  if (!existsSync(file)) {
    console.log(`  note: no ${CONFIG.localeConfig}; comparing the folders found, "${CONFIG.fallbackDefaultLocale}" as the shape source`);
    return null;
  }
  const source = readFileSync(file, "utf8");
  const list = /export\s+const\s+locales\b[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (!list) {
    fail(`${CONFIG.localeConfig} does not export a \`locales\` array`);
    return null;
  }
  const locales = [...list[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  const named = /export\s+const\s+defaultLocale\b[^=]*=\s*["']([^"']+)["']/.exec(source);
  const defaultLocale = named ? named[1] : locales[0];
  if (!locales.includes(defaultLocale)) {
    fail(`defaultLocale "${defaultLocale}" is not in the locales list`);
  }
  return { locales, defaultLocale };
}

/** Every .json file under a locale folder, as sorted posix paths. */
function catalogFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return catalogFiles(join(dir, entry.name), path);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    })
    .sort();
}

const parsed = new Map();
function readCatalog(locale, file) {
  const key = `${locale}/${file}`;
  if (!parsed.has(key)) {
    try {
      parsed.set(key, JSON.parse(readFileSync(join(MESSAGES, locale, file), "utf8")));
    } catch (error) {
      fail(`${CONFIG.messagesDir}/${key} is not valid JSON: ${error.message}`);
      parsed.set(key, null);
    }
  }
  return parsed.get(key);
}

const kindOf = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

/**
 * Placeholder names of a message, numbered ones ({0}) included. ICU branches
 * such as `{count, plural, one {# item} other {# items}}` give "count": the
 * branch bodies are translated text, not placeholders. Arguments nested inside
 * a branch body (`one {# item for {name}}`) still count.
 */
function placeholders(text) {
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") {
      // Even depth opens an argument ({name}, {0}, {count, plural, ...}); odd depth opens a branch body.
      if (depth % 2 === 0) {
        const name = /^\{\s*([\w.]+)\s*[,}]/.exec(text.slice(i));
        if (name) names.add(name[1]);
      }
      depth += 1;
    } else if (text[i] === "}" && depth > 0) {
      depth -= 1;
    }
  }
  return [...names].sort().join(", ");
}

/** Every leaf as path -> { kind, placeholders, text }. Objects are walked, not leaves. */
function leaves(value, prefix = "", into = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (kindOf(child) === "object") {
      leaves(child, path, into);
    } else {
      const text = typeof child === "string" ? child : "";
      into.set(path, { kind: kindOf(child), placeholders: placeholders(text), text });
    }
  }
  return into;
}

function checkApostrophes(locale, file, tree) {
  const curly = [...leaves(tree)].filter(([, leaf]) => /[‘’]/.test(leaf.text)).map(([path]) => path);
  if (curly.length > 0) {
    const sample = curly.slice(0, 3).map((path) => `"${path}"`).join(", ");
    fail(`${locale}/${file}: ${curly.length} string(s) use a curly apostrophe (‘ or ’), use the straight one ('): ${sample}${curly.length > 3 ? ", ..." : ""}`);
  }
}

function compare(reference, locale, file) {
  const base = readCatalog(reference, file);
  const other = readCatalog(locale, file);
  if (kindOf(base) !== "object" || kindOf(other) !== "object") {
    if (base !== null && other !== null) {
      fail(`${locale}/${file}: a catalog file holds one JSON object`);
    }
    return;
  }
  const expected = leaves(base);
  const actual = leaves(other);
  for (const [key, spec] of expected) {
    const found = actual.get(key);
    if (!found) {
      fail(`${locale}/${file}: missing key "${key}"`);
    } else if (found.kind !== spec.kind) {
      fail(`${locale}/${file}: "${key}" is a ${found.kind}, ${reference} has a ${spec.kind}`);
    } else if (found.placeholders !== spec.placeholders) {
      fail(`${locale}/${file}: "${key}" uses {${found.placeholders}}, ${reference} uses {${spec.placeholders}}`);
    }
  }
  for (const key of actual.keys()) {
    if (!expected.has(key)) {
      fail(`${locale}/${file}: extra key "${key}" (absent from ${reference})`);
    }
  }
}

function main() {
  if (!isDir(MESSAGES)) {
    console.log(`i18n check skipped: ${relative(ROOT, MESSAGES).split(sep).join("/")}/ does not exist yet.`);
    return 0;
  }
  const declared = declaredLocales();
  const folders = readdirSync(MESSAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const reference = declared?.defaultLocale ?? CONFIG.fallbackDefaultLocale;

  if (declared) {
    for (const locale of declared.locales.filter((l) => !folders.includes(l))) {
      fail(`the app declares "${locale}" but ${CONFIG.messagesDir}/${locale}/ does not exist`);
    }
    for (const folder of folders.filter((f) => !declared.locales.includes(f))) {
      fail(`${CONFIG.messagesDir}/${folder}/ exists but the app does not declare "${folder}"`);
    }
  }
  if (!folders.includes(reference)) {
    fail(`${CONFIG.messagesDir}/${reference}/ is missing: nothing to compare against`);
    return report(reference, folders, []);
  }

  const referenceFiles = catalogFiles(join(MESSAGES, reference));
  if (referenceFiles.length === 0) {
    fail(`${CONFIG.messagesDir}/${reference}/ holds no .json file`);
  }
  for (const locale of folders) {
    const files = catalogFiles(join(MESSAGES, locale));
    for (const file of files) {
      const tree = readCatalog(locale, file);
      if (kindOf(tree) === "object") {
        checkApostrophes(locale, file, tree);
      }
    }
    if (locale === reference) {
      continue;
    }
    for (const file of referenceFiles) {
      if (files.includes(file)) {
        compare(reference, locale, file);
      } else {
        fail(`${CONFIG.messagesDir}/${locale}/${file} is missing`);
      }
    }
    for (const file of files.filter((f) => !referenceFiles.includes(f))) {
      fail(`${CONFIG.messagesDir}/${locale}/${file} has no counterpart in ${reference}/`);
    }
  }
  return report(reference, folders, referenceFiles);
}

function report(reference, folders, referenceFiles) {
  if (errors.length > 0) {
    console.error("\ni18n check failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(`\n${reference}/ is the shape source. Edit every locale together, with small targeted edits.\n`);
    return 1;
  }
  const keys = referenceFiles.reduce((total, file) => {
    const tree = readCatalog(reference, file);
    return total + (kindOf(tree) === "object" ? leaves(tree).size : 0);
  }, 0);
  console.log(`i18n check passed: ${folders.length} locale(s), ${referenceFiles.length} file(s), ${keys} key(s) each.`);
  return 0;
}

process.exit(main());
