#!/usr/bin/env node
// save-chat: copies the current Claude Code session transcript into the project.
// Wired on Stop (async), PreCompact and SessionEnd. Reads the hook JSON on stdin.
//
// Rules this file keeps:
// - Never prints to stdout: on several events Claude Code would read stdout as hook output.
// - Always exits 0: a non-zero PreCompact exit can block compaction, and a backup must never
//   get in the way of the session.
// - Copies the main transcript before anything else, then the session's sibling folder
//   (subagents, tool results) incrementally, and stops at a time budget: SessionEnd hooks
//   share a 1.5 s budget, so whatever is not copied now is copied by the next run.
// - With the time left, removes the temp files that a run stopped mid-copy left behind.
//
// Options (plugin userConfig, exported to hooks as environment variables):
//   CLAUDE_PLUGIN_OPTION_SAVE_CHATS  false, 0, no or off turns the hook off (default on)
//   CLAUDE_PLUGIN_OPTION_CHATS_DIR   folder relative to the project (default claude-chats)
//   SAVE_CHAT_BUDGET_MS              overrides the time budget (tests, slow disks)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_DIR = "claude-chats";
const OFF_VALUES = new Set(["false", "0", "no", "off"]);
const GITIGNORE =
  "# Claude Code transcripts copied by the save-chat hook. They can hold secrets: never commit or share them.\n*\n";
const USAGE = "usage: echo '<hook JSON>' | node save-chat.mjs   (a Claude Code hook: Stop, PreCompact, SessionEnd)";
// The temp name copyFile uses: .<name>.<pid>.<ms>.tmp, where <ms> is when the copy started.
const TEMP_NAME = /^\..+\.\d+\.(\d+)\.tmp$/;
const STALE_TEMP_MS = 10 * 60 * 1000;

const started = Date.now();

// The whole hook is best effort: any failure ends it quietly with exit 0.
process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

function budgetMs(event) {
  const raw = process.env.SAVE_CHAT_BUDGET_MS;
  const forced = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (Number.isFinite(forced) && forced >= 0) return forced;
  // SessionEnd: leave room for Node's start-up and other plugins' hooks inside the shared 1.5 s.
  return event === "SessionEnd" ? 900 : 20000;
}

function readStdin(limitMs) {
  return new Promise((resolve) => {
    const chunks = [];
    const done = () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    // A caller that never closes stdin must not keep the hook alive.
    const timer = setTimeout(() => {
      process.stdin.destroy();
      done();
    }, limitMs);
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

function isOff(value) {
  return value !== undefined && OFF_VALUES.has(String(value).trim().toLowerCase());
}

// The chats folder must stay inside the project, below its root, where its own .gitignore keeps it out of git.
function chatsFolder(projectDir, raw) {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  // "~/x", "$HOME/x" or "%USERPROFILE%\x" are never expanded here: they would make folders named "~" or "$HOME".
  if (/^~|[$%]/.test(value)) return null;
  const root = path.resolve(projectDir);
  const dir = path.resolve(root, value);
  const parts = value.split(/[\\/]+/);
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || parts.includes("..")) return null;
  if (dir === root || !dir.startsWith(root + path.sep)) return null;
  return dir;
}

function expandHome(p) {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

// A session id becomes a file name: allow only plain name characters.
function safeName(id) {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id) ? id : null;
}

function statOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function unchanged(src, dest) {
  const d = statOrNull(dest);
  return Boolean(d && d.isFile() && d.size === src.size && Math.abs(d.mtimeMs - src.mtimeMs) < 1);
}

// Copies through a temp file and a rename, so a reader never sees half a file.
// COPYFILE_FICLONE clones on copy-on-write filesystems (Btrfs, XFS, APFS) and falls back to a plain copy.
// The copy keeps the source mtime: the next run compares size and mtime to skip unchanged files.
function copyFile(src, srcStat, dest) {
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.copyFileSync(src, tmp, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(tmp, 0o600);
    fs.utimesSync(tmp, srcStat.atimeMs / 1000, srcStat.mtimeMs / 1000);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // the temp file was never created
    }
    throw err;
  }
}

// Makes the folder ready and self-ignoring. Returns false when the folder is someone else's:
// an existing folder with other files and no ignore-all .gitignore would get the transcripts committed.
function prepareFolder(dir) {
  let st = null;
  try {
    st = fs.statSync(dir); // follows a symlink: a linked chats folder is the owner's choice
  } catch {
    // missing: created below
  }
  if (!st) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  } else if (!st.isDirectory()) {
    return false;
  }
  const ignore = path.join(dir, ".gitignore");
  if (fs.existsSync(ignore)) {
    return fs.readFileSync(ignore, "utf8").split(/\r?\n/).some((line) => line.trim() === "*");
  }
  const names = fs.readdirSync(dir);
  if (names.length > 0 && !names.includes("copies.log")) return false;
  fs.writeFileSync(ignore, GITIGNORE, { mode: 0o600 });
  return true;
}

// Walks the sibling folder depth-first and copies new or changed regular files.
// Symlinks are skipped: a link could point anywhere on the machine.
function copyTree(srcDir, destDir, deadline, counts) {
  let entries;
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    counts.errors += 1;
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (Date.now() >= deadline) {
      counts.partial = true;
      return;
    }
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      try {
        fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
      } catch {
        counts.errors += 1;
        continue;
      }
      copyTree(src, dest, deadline, counts);
      if (counts.partial) return;
    } else if (entry.isFile()) {
      const st = statOrNull(src);
      if (!st || !st.isFile()) continue;
      if (unchanged(st, dest)) {
        counts.same += 1;
        continue;
      }
      try {
        copyFile(src, st, dest);
        counts.copied += 1;
      } catch {
        counts.errors += 1;
      }
    }
  }
}

// A run stopped mid-copy (a hook timeout, a shutdown, a crash) leaves its temp file behind, as big as the
// transcript, and nothing else ever removes it. The age comes from the time in the name, not the mtime:
// a copy gets the source's mtime just before its rename, so a running copy can look old.
function sweepTemps(dir, deadline, counts) {
  const stack = [dir];
  while (stack.length > 0 && Date.now() < deadline) {
    const here = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(here, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(here, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      const m = entry.isFile() ? TEMP_NAME.exec(entry.name) : null;
      if (m && Date.now() - Number(m[1]) > STALE_TEMP_MS) {
        try {
          fs.unlinkSync(p);
          counts.swept += 1;
        } catch {
          // another run removed it first
        }
      }
    }
  }
}

function appendLog(dir, fields) {
  const line = `${new Date().toISOString()} ${Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, "_")}`)
    .join(" ")}\n`;
  fs.appendFileSync(path.join(dir, "copies.log"), line, { mode: 0o600 });
}

async function main() {
  if (process.argv.length > 2 || process.stdin.isTTY) {
    process.stderr.write(`${USAGE}\n`);
    return;
  }
  const raw = await readStdin(1000);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (!input || typeof input !== "object") return;
  if (isOff(process.env.CLAUDE_PLUGIN_OPTION_SAVE_CHATS)) return;

  const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "unknown";
  const deadline = started + budgetMs(event);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || (typeof input.cwd === "string" ? input.cwd : "");
  if (!projectDir || !isDir(projectDir)) return;

  if (typeof input.transcript_path !== "string" || input.transcript_path === "") return;
  const transcript = path.resolve(expandHome(input.transcript_path));
  if (!transcript.endsWith(".jsonl")) return;
  const id = safeName(input.session_id) ?? safeName(path.basename(transcript, ".jsonl"));
  if (!id) return;

  // A refused or unsafe chats_dir falls back to the default folder, so the chat is still saved.
  const wanted = (process.env.CLAUDE_PLUGIN_OPTION_CHATS_DIR ?? "").trim();
  const fallback = path.join(path.resolve(projectDir), DEFAULT_DIR);
  const chosen = chatsFolder(projectDir, wanted);
  let dir = chosen ?? fallback;
  let refused = wanted !== "" && !chosen ? wanted : undefined;
  if (!prepareFolder(dir)) {
    if (dir === fallback || !prepareFolder(fallback)) return;
    refused = wanted;
    dir = fallback;
  }

  // 1. The main transcript, before anything else.
  let main = "missing";
  const st = statOrNull(transcript);
  if (st && st.isFile()) {
    const dest = path.join(dir, `${id}.jsonl`);
    if (unchanged(st, dest)) {
      main = "same";
    } else {
      try {
        copyFile(transcript, st, dest);
        main = "copied";
      } catch {
        main = "error";
      }
    }
  }

  // 2. The sibling folder <session_id>/ (subagents, tool results), only what changed.
  const counts = { copied: 0, same: 0, errors: 0, partial: false, swept: 0 };
  const sibling = path.join(path.dirname(transcript), id);
  if (statOrNull(sibling)?.isDirectory()) {
    const destDir = path.join(dir, id);
    try {
      fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
      copyTree(sibling, destDir, deadline, counts);
    } catch {
      counts.errors += 1;
    }
  }

  // 3. Old temp files left by stopped runs, only after the copies and only with the time left.
  sweepTemps(dir, deadline, counts);

  appendLog(dir, {
    event,
    reason: input.reason ?? input.trigger,
    session: id,
    main,
    files: counts.copied,
    same: counts.same,
    errors: counts.errors || undefined,
    partial: counts.partial ? "yes" : undefined,
    swept: counts.swept || undefined,
    refused_dir: refused,
    ms: Date.now() - started,
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
