#!/usr/bin/env node
// Installs the kit's project files into a Next.js project, for any AI coding tool.
//
// It copies templates/ into the project (AGENTS.md, CLAUDE.md, docs/, scripts/, .claude/skills/design-direction/)
// and the skills as plain playbooks into docs/playbooks/, so a tool without the Claude Code plugin can read them.
// A project that uses the plugin gets the skills from it: pass --no-playbooks.
// It also writes runs/.gitignore, a .dockerignore (saved chats and runs/ stay out of images and uploads) and a
// .gitattributes (the shell tools keep LF line endings in a Windows clone), each only when it is missing.
//
// It never overwrites anything that exists, file or link: it lists what it skipped, so a second run is safe.
// It fills {{PROJECT_NAME}} (the folder name), {{TODAY}} (today's local date) and {{DEV_PORT}} (--port, default
// 3000) in the copied templates, and leaves {{PURPOSE}} for the owner. It writes .sh, .env, .py and .mjs files
// with LF line endings, whatever the kit's checkout holds. Playbooks are copied byte for byte: their code samples
// hold JSX braces.
//
// Node 18 or newer, no dependencies, and no shell commands, so it runs the same on macOS, Linux and Windows.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const KIT = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(KIT, "templates");
const SKILLS = path.join(KIT, "skills");
const USAGE = "usage: node install.mjs <project-dir> [--port N] [--no-playbooks] [--dry-run]";
const HELP = `${USAGE}

  <project-dir>    the Next.js app's root folder (the one with package.json); it must exist
  --port N         the dev server port, written into the docs and scripts/tools/tools.env (default 3000)
  --no-playbooks   skip docs/playbooks/: the Claude Code plugin already provides the skills
  --dry-run        print what would be created, write nothing

Never overwrites a file. Exit 0 when done, 1 when a file could not be written, 2 on wrong arguments.`;

// Build and cache folders that may sit in the kit checkout but are never part of the kit.
const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db", "__pycache__", "node_modules", ".git"]);
const TEXT_EXTENSIONS = new Set([".md", ".mjs", ".js", ".py", ".sh", ".env", ".json", ".txt"]);
const RUNS_GITIGNORE =
  "# Working files of the AI-assisted work: briefs, reports, logs, backups. Kept out of git.\n*\n";
// bash, env files and shebang lines break on CRLF, which a Windows clone of the kit may hold.
const LF_ONLY = new Set([".sh", ".env", ".py", ".mjs"]);
// Docker and some deploy tools ignore .gitignore: the saved chats can hold secrets, runs/ holds backups and logs.
const DOCKERIGNORE_LINES = ["claude-chats/", "runs/"];
const DOCKERIGNORE =
  "# Docker and some deploy tools ignore .gitignore. Saved chats (claude-chats/, or the folder the chats_dir\n" +
  "# option names) can hold secrets, and runs/ holds backups and logs: keep both out of every image and upload.\n" +
  `${DOCKERIGNORE_LINES.join("\n")}\n`;
// A Windows clone checks text files out with CRLF by default, and bash rejects them.
const GITATTRIBUTES_LINES = ["*.sh text eol=lf", "*.py text eol=lf", "scripts/tools/tools.env text eol=lf"];
const GITATTRIBUTES =
  "# Keep the shell tools runnable from a Windows clone: bash rejects CRLF line endings.\n" +
  `${GITATTRIBUTES_LINES.join("\n")}\n`;
const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm exec"],
  ["package-lock.json", "npx"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bunx"],
  ["bun.lockb", "bunx"],
];

function fail(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { dir: null, port: "3000", playbooks: true, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${HELP}\n`);
      process.exit(0);
    } else if (arg === "--no-playbooks") {
      opts.playbooks = false;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--port") {
      i += 1;
      if (i >= argv.length) fail("--port needs a number");
      opts.port = argv[i];
    } else if (arg.startsWith("--port=")) {
      opts.port = arg.slice("--port=".length);
    } else if (arg.startsWith("-")) {
      fail(`unknown option: ${arg}`);
    } else if (opts.dir === null) {
      opts.dir = arg;
    } else {
      fail(`one project folder only, got a second one: ${arg}`);
    }
  }
  if (opts.dir === null) fail("missing the project folder");
  if (!/^[1-9][0-9]{0,4}$/.test(opts.port) || Number(opts.port) > 65535) {
    fail(`not a port number (1 to 65535): ${opts.port}`);
  }
  return opts;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// lstat, not stat: a link counts as "exists" even when it points nowhere, and is never followed.
function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Every regular file under root, as paths relative to it, sorted so the output reads the same each run.
function listFiles(root, rel = "") {
  const out = [];
  const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name) || entry.name.endsWith(".pyc")) continue;
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

// The tools read DEV_PORT from tools.env, and so does the Claude Code Bash hook: the copy must carry the
// project's port, or the tools watch 3000 while the docs say otherwise.
function setToolsPort(text, port) {
  const line = /^(\s*:\s*"\$\{DEV_PORT:=)[0-9]+(\}")/m;
  return line.test(text) ? text.replace(line, `$1${port}$2`) : null;
}

function buildPlan(target, opts) {
  const values = {
    "{{PROJECT_NAME}}": path.basename(target) || "the project",
    "{{TODAY}}": today(),
    "{{DEV_PORT}}": opts.port,
  };
  const fill = (text) => Object.entries(values).reduce((acc, [token, value]) => acc.split(token).join(value), text);
  const plan = [];
  const warnings = [];

  for (const rel of listFiles(TEMPLATES)) {
    const src = path.join(TEMPLATES, rel);
    const item = { rel, src, dest: path.join(target, rel), mode: fs.statSync(src).mode & 0o777 };
    if (TEXT_EXTENSIONS.has(path.extname(rel)) || rel.endsWith(".gitignore")) {
      let text = fill(fs.readFileSync(src, "utf8"));
      if (LF_ONLY.has(path.extname(rel))) text = text.replace(/\r\n/g, "\n");
      if (path.basename(rel) === "tools.env") {
        const withPort = setToolsPort(text, opts.port);
        if (withPort === null) warnings.push("tools.env has no DEV_PORT line: set DEV_PORT there by hand");
        else text = withPort;
      }
      item.data = text;
    }
    plan.push(item);
  }

  if (opts.playbooks) {
    for (const rel of listFiles(SKILLS)) {
      const src = path.join(SKILLS, rel);
      const dest = path.join(target, "docs", "playbooks", rel);
      plan.push({ rel: path.join("docs", "playbooks", rel), src, dest, mode: fs.statSync(src).mode & 0o777 });
    }
  }

  // runs/ holds logs, PID files and backups (the dev tools write runs/dev/). It must stay out of git, and the
  // ownership sweep reads git status. A folder that ignores itself needs no edit of the project's .gitignore.
  const runs = path.join(target, "runs");
  const runsIgnore = path.join(runs, ".gitignore");
  if (!exists(runs) || (isDir(runs) && fs.readdirSync(runs).length === 0)) {
    plan.push({ rel: path.join("runs", ".gitignore"), dest: runsIgnore, mode: 0o644, data: RUNS_GITIGNORE });
  } else if (!exists(runsIgnore)) {
    warnings.push("runs/ already holds files: make sure git ignores it (add `runs/` to .gitignore)");
  }

  const lacks = (name, why) => `${name} was already there and lacks these lines (${why}). Add them by hand:`;
  addOrWarn(target, ".dockerignore", DOCKERIGNORE, DOCKERIGNORE_LINES, ignoresFolder, plan, warnings,
    lacks(".dockerignore", "Docker and some deploy tools ignore .gitignore"));
  addOrWarn(target, ".gitattributes", GITATTRIBUTES, GITATTRIBUTES_LINES, keepsLf, plan, warnings,
    lacks(".gitattributes", "bash rejects the CRLF line endings of a Windows clone"));
  return { plan, warnings };
}

// A project file the kit needs a few lines in: written when missing. An existing one is never edited, so a
// warning names the lines it still lacks.
function addOrWarn(target, name, content, wanted, covers, plan, warnings, warning) {
  const dest = path.join(target, name);
  if (!exists(dest)) {
    plan.push({ rel: name, dest, mode: 0o644, data: content });
    return;
  }
  let lines = [];
  try {
    lines = fs.readFileSync(dest, "utf8").split(/\r?\n/);
  } catch {
    // Not a readable file (a folder, a dangling link): every line is missing.
  }
  const missing = wanted.filter((line) => !covers(lines, line));
  if (missing.length > 0) {
    warnings.push([warning, ...missing.map((line) => `      ${line}`)].join("\n"));
  }
}

// "claude-chats", "claude-chats/", "/claude-chats" and "/claude-chats/" all keep the folder out of a build.
function ignoresFolder(lines, wanted) {
  const name = wanted.replace(/\/$/, "");
  return lines.some((line) => line.trim().replace(/^\//, "").replace(/\/$/, "") === name);
}

// The same pattern with eol=lf, or a "*" line with eol=lf, keeps those files LF.
function keepsLf(lines, wanted) {
  const pattern = wanted.split(/\s+/)[0];
  return lines.some((line) => {
    const [first, ...attributes] = line.trim().split(/\s+/);
    return (first === pattern || first === "*") && attributes.includes("eol=lf");
  });
}

function writeItem(item) {
  fs.mkdirSync(path.dirname(item.dest), { recursive: true });
  // "wx" fails when anything exists at the path, even a dangling link: the last guard against an overwrite.
  if (item.data !== undefined) fs.writeFileSync(item.dest, item.data, { flag: "wx", mode: item.mode });
  else fs.copyFileSync(item.src, item.dest, fs.constants.COPYFILE_EXCL);
  try {
    fs.chmodSync(item.dest, item.mode); // keeps the tools executable whatever the umask
  } catch {
    // Windows has no execute bit: nothing to keep.
  }
}

function nextSteps(opts, pm) {
  const setup = opts.playbooks
    ? "docs/playbooks/new-project/SKILL.md (in Claude Code: /perfect-vibecoding-rules-nextjs:new-project)"
    : "/perfect-vibecoding-rules-nextjs:new-project in Claude Code";
  const steps = [
    "Write the project's purpose, one line, where {{PURPOSE}} stands: AGENTS.md and docs/PROGRESS.md.",
    `Add the package.json scripts (typecheck, check:*, verify) and spread scripts/eslint-rules.mjs into eslint.config.mjs: ${setup}.`,
    "Fill .claude/skills/design-direction/SKILL.md once the visual direction is settled.",
    "Review the new files with `git status`, then commit them.",
  ];
  if (pm && pm !== "pnpm exec") steps.splice(2, 0, `This project's lockfile says: set PM_EXEC to "${pm}" in scripts/tools/tools.env.`);
  return steps.map((step, n) => `  ${n + 1}. ${step}`).join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = path.resolve(opts.dir);
  if (!isDir(target)) fail(`not a folder: ${opts.dir} (create the app first, for example with create-next-app)`);
  const fromKit = path.relative(KIT, target);
  if (fromKit === "" || (!fromKit.startsWith("..") && !path.isAbsolute(fromKit))) {
    fail(`refused: ${target} is the kit itself, or inside it. Give the project's folder.`);
  }

  const { plan, warnings } = buildPlan(target, opts);
  const pm = LOCKFILES.find(([file]) => exists(path.join(target, file)))?.[1];
  if (!exists(path.join(target, "package.json"))) {
    warnings.unshift(
      "no package.json here. Create the Next.js app first (create-next-app wants an empty folder), or check the path.",
    );
  }

  const verb = opts.dryRun ? "would create" : "created";
  console.log(`perfect-vibecoding-rules-nextjs: ${opts.dryRun ? "dry run for" : "installing into"} ${target}`);
  console.log(`  project name: ${path.basename(target)}, dev port: ${opts.port}, playbooks: ${opts.playbooks ? "yes" : "no"}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);

  const counts = { created: 0, skipped: 0, failed: 0 };
  const skipped = new Set();
  for (const item of plan) {
    const shown = item.rel.split(path.sep).join("/");
    if (exists(item.dest)) {
      counts.skipped += 1;
      skipped.add(shown);
      console.log(`  skipped  ${shown} (already exists, left as it is)`);
      continue;
    }
    if (opts.dryRun) {
      counts.created += 1;
      console.log(`  ${verb}  ${shown}`);
      continue;
    }
    try {
      writeItem(item);
      counts.created += 1;
      console.log(`  ${verb}  ${shown}`);
    } catch (error) {
      // EEXIST for the file itself: it appeared since the check. EEXIST for a folder on the way (a file named
      // like the folder) is a real failure.
      if (error && error.code === "EEXIST" && exists(item.dest)) {
        counts.skipped += 1;
        skipped.add(shown);
        console.log(`  skipped  ${shown} (already exists, left as it is)`);
      } else {
        counts.failed += 1;
        const code = error && error.code ? error.code : String(error);
        const why = code === "EEXIST" || code === "ENOTDIR" ? `a file stands where a folder must go (${code})` : code;
        console.log(`  FAILED   ${shown}: ${why}`);
      }
    }
  }

  console.log(
    `\n${counts.created} ${verb}, ${counts.skipped} skipped (they already existed; nothing was overwritten), ${counts.failed} failed.`,
  );
  for (const note of mergeNotes(target, skipped)) console.log(`  warning: ${note}`);
  if (!opts.dryRun && counts.created > 0) console.log(`\nNext steps:\n${nextSteps(opts, pm)}`);
  process.exitCode = counts.failed > 0 ? 1 : 0;
}

// The two files every tool reads first. A project's own copy is kept, so say what it still lacks.
function mergeNotes(target, skipped) {
  const read = (name) => {
    try {
      return fs.readFileSync(path.join(target, name), "utf8");
    } catch {
      return "";
    }
  };
  const notes = [];
  // The kit's AGENTS.md ends with the playbooks table: a file without it never got the kit's rules.
  if (skipped.has("AGENTS.md") && !read("AGENTS.md").includes("docs/playbooks/code-rules/SKILL.md")) {
    notes.push(`AGENTS.md was already there: merge the kit's rules into it by hand (${path.join(TEMPLATES, "AGENTS.md")}).`);
  }
  // With a CLAUDE.md present, Claude Code reads it instead of AGENTS.md, unless CLAUDE.md imports AGENTS.md.
  if (skipped.has("CLAUDE.md") && !/^@AGENTS\.md\s*$/m.test(read("CLAUDE.md"))) {
    notes.push("CLAUDE.md was already there and does not import AGENTS.md: add the line @AGENTS.md at its top.");
  }
  return notes;
}

main();
