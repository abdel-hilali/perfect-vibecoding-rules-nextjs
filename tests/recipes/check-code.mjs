#!/usr/bin/env node
// Checks the fenced code blocks of every Markdown file in a folder:
//   ts, tsx, js, mjs -> parsed by the TypeScript compiler (syntax only), when one can be found;
//                       always: no hook called behind `??`, `&&`, `||` or `?`, and each top-level
//                       function within the kit's size limit for the path on the block's first line;
//   css               -> braces balance;
//   json              -> JSON.parse.
// TypeScript is looked up in $TYPESCRIPT_MODULE (a path to the package), then from the current directory,
// then next to this script. Without it the script says SKIP for those blocks and still checks the rest.
// Usage: node check-code.mjs <folder>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error("usage: node check-code.mjs <folder>");
  process.exit(2);
}

async function loadTypeScript() {
  const candidates = [];
  if (process.env.TYPESCRIPT_MODULE) {
    candidates.push(process.env.TYPESCRIPT_MODULE);
  }
  for (const base of [join(process.cwd(), "noop.js"), import.meta.url]) {
    try {
      candidates.push(createRequire(base).resolve("typescript"));
    } catch {
      // not installed there
    }
  }
  for (const candidate of candidates) {
    try {
      const target = existsSync(join(candidate, "package.json")) ? createRequire(join(candidate, "noop.js")).resolve(candidate) : candidate;
      const module = await import(pathToFileURL(target).href);
      return module.default ?? module;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** Every fenced block: its language, its first line number and its text. */
function blocks(text) {
  const found = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^```([a-z]+)\s*$/.exec(lines[i]);
    if (!open) {
      continue;
    }
    const start = i + 1;
    let end = start;
    while (end < lines.length && lines[end] !== "```") {
      end += 1;
    }
    found.push({ lang: open[1], line: start + 1, code: lines.slice(start, end).join("\n") });
    i = end;
  }
  return found;
}

function balanced(code) {
  let depth = 0;
  for (const char of code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"/g, "")) {
    depth += char === "{" ? 1 : char === "}" ? -1 : 0;
    if (depth < 0) {
      return false;
    }
  }
  return depth === 0;
}

// A hook behind `??`, `&&`, `||` or a ternary runs on some renders only: React's rules of hooks forbid it.
const CONDITIONAL_HOOK = /(?:\?\?|&&|\|\||\?\s)[^;]*?\buse[A-Z]\w*\s*\(/;

/** A line in the block that calls a hook conditionally, or null. */
function conditionalHook(block) {
  const at = block.code.split("\n").findIndex((line) => CONDITIONAL_HOOK.test(line));
  return at < 0 ? null : `line ${block.line + at}: a hook is called conditionally`;
}

/** The function size limit of `eslint-rules.mjs` (sizeLimits; the last matching block wins). 0: no limit. */
function functionLimit(path) {
  if (/^scripts\/|\.(test|spec)\.|^e2e\/|^tests\/|__tests__\//.test(path)) {
    return 0;
  }
  if (/(^|\/)app\/api\/.*\/route\.(js|ts)$/.test(path)) {
    return 50;
  }
  if (/(^|\/)hooks\/|(^|\/)use-[^/]*$/.test(path)) {
    return 60;
  }
  if (/(^|\/)(lib|utils|helpers)\/.*\.(js|mjs|cjs|ts|mts|cts)$/.test(path)) {
    return 50;
  }
  return /\.(jsx|tsx)$/.test(path) ? 190 : 60;
}

const FUNCTION_START = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b|^(?:export\s+)?const\s+\w+\s*=.*=>\s*\{$/;

/** Braces opened minus braces closed on a line, outside strings and line comments. */
function braceDelta(line) {
  const code = line.replace(/\\./g, "").replace(/"[^"]*"|'[^']*'/g, "").replace(/\/\/.*$/, "");
  return (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
}

/** Top-level functions over the limit for the path named on the block's first line, counted as ESLint counts. */
function oversized(block) {
  const path = /^\/\/ ([\w./[\]()@-]+\.(?:ts|tsx|js|mjs))\b/.exec(block.code)?.[1];
  const limit = path ? functionLimit(path) : 0;
  const lines = block.code.split("\n");
  const problems = [];
  for (let i = 0; limit > 0 && i < lines.length; i += 1) {
    if (!FUNCTION_START.test(lines[i])) {
      continue;
    }
    let end = i;
    for (let depth = braceDelta(lines[i]); depth > 0 && end + 1 < lines.length; depth += braceDelta(lines[end])) {
      end += 1;
    }
    let inComment = false;
    const counted = lines.slice(i, end + 1).filter((line) => {
      const text = line.trim();
      const comment = inComment || text.startsWith("//") || text.startsWith("/*");
      inComment = (inComment || text.startsWith("/*")) && !text.endsWith("*/");
      return text !== "" && !comment;
    }).length;
    if (counted > limit) {
      problems.push(`line ${block.line + i}: a function has ${counted} counted lines, over the ${limit} allowed in ${path}`);
    }
    i = end;
  }
  return problems.length ? problems.join("; ") : null;
}

const ts = await loadTypeScript();
const EXT = { ts: "ts", tsx: "tsx", js: "js", mjs: "mjs" };
let failures = 0;
let checked = 0;
let skipped = 0;

for (const file of readdirSync(dir).filter((name) => name.endsWith(".md")).sort()) {
  for (const block of blocks(readFileSync(join(dir, file), "utf8"))) {
    const where = `${file}:${block.line} (${block.lang})`;
    let problem = null;
    if (EXT[block.lang]) {
      for (const rule of [conditionalHook(block), oversized(block)].filter(Boolean)) {
        failures += 1;
        console.log(`FAIL ${where}: ${rule}`);
      }
      if (!ts) {
        skipped += 1;
        continue;
      }
      const out = ts.transpileModule(block.code, {
        fileName: `block.${EXT[block.lang]}`,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
      });
      const first = out.diagnostics?.[0];
      if (first) {
        const { line } = first.file ? first.file.getLineAndCharacterOfPosition(first.start ?? 0) : { line: 0 };
        problem = `line ${block.line + line}: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`;
      }
    } else if (block.lang === "css") {
      problem = balanced(block.code) ? null : "braces do not balance";
    } else if (block.lang === "json") {
      try {
        JSON.parse(block.code);
      } catch (error) {
        problem = error.message;
      }
    } else {
      continue;
    }
    checked += 1;
    if (problem) {
      failures += 1;
      console.log(`FAIL ${where}: ${problem}`);
    }
  }
}

if (skipped > 0) {
  console.log(`SKIP ${skipped} TypeScript/JavaScript block(s): no typescript found (set TYPESCRIPT_MODULE)`);
}
console.log(`check-code: ${checked} block(s) checked, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
