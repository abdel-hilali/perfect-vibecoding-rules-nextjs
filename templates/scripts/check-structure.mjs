#!/usr/bin/env node
/**
 * Structure check: the file-layout rules of docs/RULES.md, as a build failure.
 *
 * Layout rules decay quietly: one file in the wrong folder, one route that
 * mirrors the backend, and soon nobody knows what the rule was. This turns
 * them into a failing command. Each check is skipped while its folder does
 * not exist yet, so a young project passes and the rule starts biting the
 * day the folder appears.
 *
 * Checks:
 *   1. domains     every folder in `domainsDir` holds only the five domain files (plus tests)
 *   2. api routes  only route files under `apiDir`; each one calls the shared relay;
 *                  no hand-rolled cookie or CSRF code; dynamic segments come LAST
 *   3. kebab-case  file names in `kebabDirs`
 *   4. mirror      every top-level folder in `componentsDir` names a route segment
 *                  (cross-page folders are listed in `sharedComponentDirs`)
 *   5. use client  a module without "use client" never imports an UPPER_CASE value
 *                  from a "use client" module: on the server it is a client reference
 *                  and its fields read undefined
 *   6. file size   counted lines (blank and comment-only lines do not count);
 *                  generated primitives (`generatedDirs`) are exempt
 *
 * Usage: node scripts/check-structure.mjs [project-dir]
 * No dependencies; Node 18 or newer.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

/* -- Configuration: adjust to the project. Paths are relative to its root. -- */

const CONFIG = {
  // One folder per backend domain, holding only these files (tests allowed).
  domainsDir: "src/lib/apis",
  domainFiles: ["types.ts", "form-schemas.ts", "server-apis.ts", "apis.ts", "actions.ts"],
  // The same-origin relay: route files only, each calling the shared helper.
  apiDir: "src/app/api",
  routeFileNames: ["route.ts", "route.js"],
  relayCall: "proxy(",
  // Folders whose file names must be kebab-case.
  kebabDirs: ["src/components", "src/lib", "src/hooks"],
  // Components mirror routes; these top-level component folders are cross-page.
  componentsDir: "src/components",
  appDir: "src/app",
  sharedComponentDirs: ["shared", "ui", "overrides"],
  // Where the client-constant check reads code, and the import aliases it follows.
  sourceDir: "src",
  aliases: { "@/": "src/" },
  // Counted-line limits per file kind. Everything under e2e/ and tests/ is a test file.
  sizeRoots: ["src", "e2e", "tests"],
  maxLines: { source: 300, test: 400, route: 150 },
  // Generated primitives are exempt from the size limits (and the theme rules): never edited by hand.
  generatedDirs: ["src/components/ui"],
  // Old files tolerated over the limit until someone splits them: "path": "reason".
  sizeExceptions: {},
};

/* -- Arguments ------------------------------------------------------------- */

const USAGE = "Usage: node scripts/check-structure.mjs [project-dir]";
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

const problems = [];
const notes = [];
const fail = (file, message) => problems.push({ file, message });
const at = (path) => join(ROOT, path);
const rel = (full) => relative(ROOT, full).split(sep).join("/");

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "out", "coverage"]);
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

function walk(dir, onFile) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        walk(full, onFile);
      }
    } else {
      onFile(full, entry.name);
    }
  }
}

/** Runs `check` only when `dir` exists; otherwise records that it was skipped. */
function whenPresent(dir, label, check) {
  if (isDir(at(dir))) {
    check(at(dir));
  } else {
    notes.push(`skipped ${label}: ${dir}/ does not exist yet`);
  }
}

/* -- 1. Domain folders hold only the five files ----------------------------- */

whenPresent(CONFIG.domainsDir, "domains", (domainsDir) => {
  const allowed = new Set(CONFIG.domainFiles);
  for (const entry of readdirSync(domainsDir, { withFileTypes: true })) {
    const where = `${CONFIG.domainsDir}/${entry.name}`;
    if (!entry.isDirectory()) {
      fail(where, "one folder per domain here, no loose files");
      continue;
    }
    let sources = 0;
    for (const inner of readdirSync(join(domainsDir, entry.name), { withFileTypes: true })) {
      if (inner.isDirectory()) {
        if (inner.name !== "__tests__") {
          fail(`${where}/${inner.name}`, "a domain folder holds files only, no subfolders");
        }
        continue;
      }
      if (!SOURCE_FILE.test(inner.name) || TEST_FILE.test(inner.name)) {
        continue;
      }
      sources += 1;
      if (!allowed.has(inner.name)) {
        fail(`${where}/${inner.name}`, `not one of the domain files: ${CONFIG.domainFiles.join(", ")}`);
      }
    }
    if (sources === 0) {
      fail(where, "domain folder has no source file");
    }
  }
});

/* -- 2. API route files: one-line relays, ids last -------------------------- */

whenPresent(CONFIG.apiDir, "api routes", (apiDir) => {
  walk(apiDir, (full, name) => {
    const file = rel(full);
    if (!CONFIG.routeFileNames.includes(name)) {
      fail(file, `only ${CONFIG.routeFileNames.join(" or ")} files belong under ${CONFIG.apiDir}`);
      return;
    }
    const source = readFileSync(full, "utf8");
    if (!source.includes(CONFIG.relayCall)) {
      fail(file, `a route file is one call to the shared relay: ${CONFIG.relayCall}...)`);
    }
    if (/\bcookies\(\)|set-cookie|x-csrf-token/i.test(source)) {
      fail(file, "hand-rolled cookie or CSRF forwarding: the shared relay owns it");
    }
    // Route groups "(name)" do not change the URL, so they do not count.
    const segments = relative(apiDir, dirname(full)).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
    const firstParam = segments.findIndex((s) => s.startsWith("["));
    const late = firstParam === -1 ? undefined : segments.slice(firstParam).find((s) => !s.startsWith("["));
    if (late !== undefined) {
      fail(file, `"${late}" comes after a dynamic segment: ids go last (.../<action>/[id]/[sub])`);
    }
  });
});

/* -- 3. Kebab-case file names ----------------------------------------------- */

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)*$/;
for (const dir of CONFIG.kebabDirs) {
  whenPresent(dir, "kebab-case", (full) => {
    walk(full, (path, name) => {
      if (SOURCE_FILE.test(name) && !KEBAB.test(name)) {
        fail(rel(path), "file names are kebab-case (my-thing.tsx)");
      }
    });
  });
}

/* -- 4. Components mirror routes -------------------------------------------- */

function routeSegments(dir, into = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      into.add(entry.name.replace(/^\((.*)\)$/, "$1").replace(/^@/, ""));
      routeSegments(join(dir, entry.name), into);
    }
  }
  return into;
}

whenPresent(CONFIG.componentsDir, "components mirror", (componentsDir) => {
  if (!isDir(at(CONFIG.appDir))) {
    notes.push(`skipped components mirror: ${CONFIG.appDir}/ does not exist yet`);
    return;
  }
  const segments = routeSegments(at(CONFIG.appDir));
  const shared = new Set(CONFIG.sharedComponentDirs);
  for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !shared.has(entry.name) && !segments.has(entry.name)) {
      fail(
        `${CONFIG.componentsDir}/${entry.name}`,
        `no route segment named "${entry.name}": page pieces mirror the route tree; cross-page pieces go in ${CONFIG.sharedComponentDirs.join(", ")}`,
      );
    }
  }
});

/* -- 5. No UPPER_CASE value crosses the "use client" boundary --------------- */

// The directive must be the first statement. Comments are skipped by hand:
// a regex over repeated comments can backtrack for a very long time.
function isClientModule(source) {
  let i = 0;
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      return /^["']use client["']/.test(source.slice(i, i + 12));
    }
  }
}

const CONSTANT = /^[A-Z][A-Z0-9_]*$/;
const NAMED_FROM = /(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const sources = new Map();

function resolveImport(from, spec) {
  let base = null;
  for (const [prefix, target] of Object.entries(CONFIG.aliases)) {
    if (spec.startsWith(prefix)) {
      base = at(target + spec.slice(prefix.length));
    }
  }
  if (base === null && spec.startsWith(".")) {
    base = join(dirname(from), spec);
  }
  if (base === null) {
    return null;
  }
  const endings = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
  return endings.map((ending) => base + ending).find((path) => sources.has(path)) ?? null;
}

/** [imported, local] value names of one `{ ... }` clause; type-only names dropped. */
const valueNames = (clause) =>
  clause
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith("type "))
    .map((part) => part.split(/\s+as\s+/).map((side) => side.trim()));

/** The "use client" file a name really comes from, following plain re-exports. */
function clientOrigin(file, name, seen = new Set()) {
  if (file === null || seen.has(file)) {
    return null;
  }
  seen.add(file);
  const source = sources.get(file);
  if (isClientModule(source)) {
    return file;
  }
  for (const [, kind, typeOnly, clause, spec] of source.matchAll(NAMED_FROM)) {
    const hit = kind === "export" && !typeOnly && valueNames(clause).find((pair) => pair.at(-1) === name);
    if (hit) {
      return clientOrigin(resolveImport(file, spec), hit[0], seen);
    }
  }
  return null;
}

whenPresent(CONFIG.sourceDir, "use client constants", (sourceDir) => {
  walk(sourceDir, (full, name) => {
    if (SOURCE_FILE.test(name) && !TEST_FILE.test(name)) {
      sources.set(full, readFileSync(full, "utf8"));
    }
  });
  for (const [file, source] of sources) {
    if (isClientModule(source)) {
      continue;
    }
    for (const [, kind, typeOnly, clause, spec] of source.matchAll(NAMED_FROM)) {
      if (kind !== "import" || typeOnly) {
        continue;
      }
      for (const [imported] of valueNames(clause).filter(([n]) => CONSTANT.test(n))) {
        const origin = clientOrigin(resolveImport(file, spec), imported);
        if (origin !== null) {
          fail(
            rel(file),
            `imports ${imported} from the "use client" module ${rel(origin)}: on the server it is undefined. Move it to a plain module both sides import.`,
          );
        }
      }
    }
  }
});

/* -- 6. File size in counted lines ------------------------------------------ */

/**
 * Lines that hold code: blank lines and comment-only lines do not count, like
 * ESLint's max-lines with skipBlankLines and skipComments. A small lexer walks
 * strings, template literals and regular expressions so that "//" inside them
 * is not taken for a comment. A "/*" that opens after code and stays open past
 * the line end is JSX text (a glob such as src/*), not a comment.
 */
function countCodeLines(text) {
  const counted = new Set();
  const stack = [{ template: false, depth: 0 }];
  let line = 1;
  let i = 0;
  let prev = "";
  const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);
  const regexAllowed = () => prev === "" || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || KEYWORDS_BEFORE_REGEX.has(prev);

  // Skips a quoted body that ends at `close`; it never crosses a line end.
  const skipLine = (close) => {
    while (i < text.length && text[i] !== close && text[i] !== "\n") {
      i += text[i] === "\\" && text[i + 1] !== "\n" ? 2 : 1;
    }
    if (text[i] === close) i += 1;
  };

  while (i < text.length) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (top.template) {
      counted.add(line);
      if (c === "\\") {
        i += text[i + 1] === "\n" ? 1 : 2;
      } else if (c === "`") {
        stack.pop();
        prev = "`";
        i += 1;
      } else if (c === "$" && text[i + 1] === "{") {
        stack.push({ template: false, depth: 0 });
        prev = "{";
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const eol = text.indexOf("\n", i);
      // Opened after code and still open at the line end: JSX text such as "src/*", not a comment.
      if (counted.has(line) && (close === -1 || (eol !== -1 && close > eol))) {
        i += 2;
        continue;
      }
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    counted.add(line);
    if (c === '"' || c === "'") {
      i += 1;
      skipLine(c);
      prev = "x";
    } else if (c === "`") {
      stack.push({ template: true, depth: 0 });
      i += 1;
    } else if (c === "/" && regexAllowed()) {
      i += 1;
      let inClass = false;
      while (i < text.length && text[i] !== "\n" && (inClass || text[i] !== "/")) {
        if (text[i] === "[") inClass = true;
        else if (text[i] === "]") inClass = false;
        i += text[i] === "\\" && text[i + 1] !== "\n" ? 2 : 1;
      }
      if (text[i] === "/") i += 1;
      prev = "x";
    } else if (/[\w$]/.test(c)) {
      const start = i;
      while (i < text.length && /[\w$]/.test(text[i])) i += 1;
      prev = text.slice(start, i);
    } else {
      if (c === "{") {
        top.depth += 1;
      } else if (c === "}") {
        if (top.depth === 0 && stack.length > 1) {
          stack.pop();
          i += 1;
          continue;
        }
        top.depth -= 1;
      }
      prev = c;
      i += 1;
    }
  }
  return counted.size;
}

const isRoute = (path) =>
  path.startsWith(`${CONFIG.apiDir}/`) && CONFIG.routeFileNames.includes(path.split("/").pop());
const isTest = (path, root) =>
  TEST_FILE.test(path) || path.includes("/__tests__/") || root === "e2e" || root === "tests";

const tolerated = new Set();
for (const root of CONFIG.sizeRoots) {
  whenPresent(root, "file size", (full) => {
    walk(full, (path, name) => {
      if (!SOURCE_FILE.test(name)) {
        return;
      }
      const file = rel(path);
      if (CONFIG.generatedDirs.some((dir) => file.startsWith(`${dir}/`))) {
        return;
      }
      const kind = isRoute(file) ? "route" : isTest(file, root) ? "test" : "source";
      const limit = CONFIG.maxLines[kind];
      const lines = countCodeLines(readFileSync(path, "utf8"));
      if (lines <= limit) {
        return;
      }
      if (Object.hasOwn(CONFIG.sizeExceptions, file)) {
        tolerated.add(file);
        notes.push(`tolerated: ${file} has ${lines} counted lines (limit ${limit}): ${CONFIG.sizeExceptions[file]}`);
      } else {
        fail(file, `${lines} counted lines, the limit for a ${kind} file is ${limit}: split it by responsibility`);
      }
    });
  });
}
for (const file of Object.keys(CONFIG.sizeExceptions)) {
  if (!tolerated.has(file)) {
    notes.push(`sizeExceptions lists ${file}, which is no longer over its limit (or gone): remove the entry`);
  }
}

/* -- Report ----------------------------------------------------------------- */

for (const note of notes) {
  console.log(`  note: ${note}`);
}
if (problems.length > 0) {
  console.error(`\nstructure check failed: ${problems.length} problem(s)\n`);
  for (const { file, message } of problems) {
    console.error(`  ${file}\n      ${message}`);
  }
  console.error("\nThe rules are in docs/RULES.md (size limits, the API relay, structure).\n");
  process.exit(1);
}
console.log("structure check passed.");
