#!/usr/bin/env node
// Checks the recipes skill folder: frontmatter, index links, recipe structure, line caps,
// required content per recipe, tool-neutral bodies, that every URL or e-mail stays generic, that
// domain files sit in src/lib/apis/<domain>/, and the theme palette (dark parity, contrast).
// Usage: node check-recipes.mjs <skill-dir> [--no-expect]
//   --no-expect skips the checks that need the real recipe set (used on small bad fixtures).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const dir = args.find((arg) => !arg.startsWith("--"));
const expectFullSet = !args.includes("--no-expect");
if (!dir || !existsSync(dir)) {
  console.error("usage: node check-recipes.mjs <skill-dir> [--no-expect]");
  process.exit(2);
}

const ALLOWED_KEYS = ["name", "description", "when_to_use", "argument-hint", "disable-model-invocation", "allowed-tools"];
const SECTIONS = ["## Problem", "## Rule", "## Code", "## Traps"];
const RECIPE_MAX_LINES = 160; // "under about 150": the cap leaves room for one more trap
const INDEX_MAX_BODY_LINES = 120;
const ALLOWED_HOSTS = [/^(.+\.)?example\.com$/, /^localhost$/, /^app\.invalid$/];

// What each recipe must keep saying. A pattern is a RegExp source, matched case-sensitively.
const MUST = {
  "theme.md": [":root", "\\.dark", "var\\(", "@theme inline", 'attribute="class"', 'defaultTheme="system"',
    "enableSystem", "suppressHydrationWarning", "resolvedTheme", "`dark:`", "bg-white", "check:theme",
    "tailwind-merge", "wash-\\*", "localStorage", "before paint",
    "`src/components/ui/` are exempt from the theme rules and the size limits"],
  "i18n.md": ["messages/<locale>/", "`en` is the shape source", "check:i18n", "check:json", "’",
    "whole catalog", "src/lib/i18n/config\\.ts", "generateStaticParams", "duplicate keys"],
  "api-relay.md": ["same-origin `/api/\\*`", "<action-in-kebab>/\\[id\\]/\\[sub\\]/route\\.ts", "ids LAST",
    "never mirrors", "proxy\\(", "Set-Cookie", "CSRF", "request id", "NEXT_PUBLIC_", "server-only",
    "<a href download>", "getSetCookie", "redirect: \"manual\""],
  "server-fetch.md": ["fetchServer", 'import "server-only"', 'cache: "no-store"', "`cache\\(\\)`", "ApiError",
    "never on `message`", "CSRF_TOKEN_INVALID", "retry ONCE", "documented fields", "stack trace", "clientFetch",
    "process\\.env\\.NEXT_PUBLIC_API_BASE_URL"],
  "guards.md": ["src/proxy\\.ts", "middleware\\.ts", "requireAuth", "requireAccess", "forbidden\\(\\)", "<Gate",
    "canAccess", "meets", "Never a role", "\\?next=", "GET or HEAD", "authInterrupts", "final\\s+authority",
    "`requireAuth\\(locale\\)`", "`await requireAccess\\(locale, AREA, LEVEL\\)`"],
  "forms.md": ["react-hook-form", "zodResolver", "z\\.infer", "\\.partial\\(\\)", "\\.pick\\(\\)", "\\.omit\\(\\)",
    '"use server"', "safeParse", "revalidatePath", "noValidate", "superRefine", "ONLY validator"],
  "url-filters.md": ['method="get"', "router\\.replace", "scroll: false", "searchParams", "\\.catch\\(undefined\\)",
    "cursor", "minLength", "no-JavaScript", "URL is the single source"],
  "feedback.md": ["<Toaster", "unstyled: true", "toast\\(\\)", "loading\\.tsx", "error\\.tsx", "not-found\\.tsx",
    "notFound\\(\\)", "digest", "ONE toaster"],
  "realtime.md": ["NEXT_PUBLIC_WEBSOCKET_URL", "SHORT-LIVED", "HttpOnly", "keyof", "REST", "throw new Error",
    "stop\\(\\)", "visibilitychange", "429", "keyed by the user id", "at-most-once",
    "src/app/api/realtime/issue-token/route\\.ts", '"/realtime/issue-token"'],
  "motion.md": ["150 to 300 ms", "Reduced motion = NONE", "prefers-reduced-motion",
    "opacity, scale, translate, rotate, box-shadow and colour", "backwards", "forwards", "stagger",
    "Loops only while", "usePrefersReducedMotion", "position: fixed", "--motion-duration-short"],
  "media-links.md": ["resolveMediaUrl", "AppImage", "AppLink", "AppAnchor", "remotePatterns", "wildcard",
    "noopener", "preload", "unoptimized", "`http:`"],
  "env.md": ["NEXT_PUBLIC_", "SCOPE \\(build or runtime\\)", "!\\.env\\.example", "--strict", "prebuild",
    "<redacted>", "secret", "ARG "],
  "seo.md": ["buildPageMetadata", "generateMetadata", "metadataBase", "hreflang", "x-default", "noIndex",
    "robots\\.ts", "sitemap\\.ts", "canonical"],
  "e2e.md": ["next build && next start", "next dev", "Accept-Language", "colorScheme", "routeFromHAR",
    'notFound: "fallback"', "waitForURL", "clearCookies", "Single-use", "animationend", "BEFORE E2E",
    "READ-ONLY", "one engine", "throttles", "existsSync\\(har\\)", "whole `e2e/fixtures/` folder",
    "next/font", "invite-token-"],
  "traps.md": ['"use client"', "undefined` on the server", "resolvedTheme", "`priority`", "`preload`",
    "position: fixed", "translate", "prefetch", "/api/\\*", "loading\\.tsx", "unstable_rethrow",
    "authInterrupts", "tailwind-merge", "content-encoding", "proxy\\.ts", "`AppAnchor` and `download`"],
};

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};
const ok = (message) => console.log(`ok   ${message}`);

/** The text between two headings, or null when the heading is missing. */
function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) {
    return null;
  }
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

function checkIndex(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    fail("SKILL.md: line 1 must be ---");
    return;
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    fail("SKILL.md: frontmatter is not closed");
    return;
  }
  const fields = Object.fromEntries(lines.slice(1, end).map((line) => {
    const at = line.indexOf(":");
    return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
  }));
  const extra = Object.keys(fields).filter((key) => !ALLOWED_KEYS.includes(key));
  extra.length ? fail(`SKILL.md: frontmatter keys not allowed: ${extra.join(", ")}`) : ok("SKILL.md frontmatter keys");
  fields.name === basename(dir) ? ok("SKILL.md name = folder") : fail(`SKILL.md: name "${fields.name}" != folder`);
  const description = fields.description ?? "";
  description.length > 0 && description.length <= 600
    ? ok(`SKILL.md description length ${description.length}`)
    : fail(`SKILL.md: description length ${description.length} (1..600)`);
  /Use when /.test(description) ? ok("SKILL.md description says Use when") : fail("SKILL.md: no 'Use when' in description");
  const body = lines.length - end - 1;
  body <= INDEX_MAX_BODY_LINES ? ok(`SKILL.md body ${body} lines`) : fail(`SKILL.md: body ${body} lines > ${INDEX_MAX_BODY_LINES}`);
  const claudeParagraphs = text.split("In Claude Code:").length - 1;
  claudeParagraphs === 1 ? ok("SKILL.md has one 'In Claude Code:' paragraph")
    : fail(`SKILL.md: ${claudeParagraphs} 'In Claude Code:' paragraphs (want 1)`);
}

function checkLinks(text, recipes) {
  const links = [...text.matchAll(/\]\(([^)#]+\.md)\)/g)].map((match) => match[1]);
  for (const link of links) {
    if (!existsSync(join(dir, link))) {
      fail(`SKILL.md links to missing ${link}`);
    }
  }
  for (const recipe of recipes) {
    if (!links.includes(recipe)) {
      fail(`SKILL.md does not link ${recipe}`);
    }
  }
  ok(`index links checked (${links.length} links, ${recipes.length} recipe files)`);
}

function checkRecipe(name, text) {
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  lines <= RECIPE_MAX_LINES ? ok(`${name}: ${lines} lines`) : fail(`${name}: ${lines} lines > ${RECIPE_MAX_LINES}`);
  if (!text.startsWith("# ")) {
    fail(`${name}: must start with a "# " title`);
  }
  let last = -1;
  for (const heading of SECTIONS) {
    const at = text.indexOf(`\n${heading}\n`);
    if (at < 0 || at < last) {
      fail(`${name}: section "${heading}" missing or out of order`);
    }
    last = at;
  }
  const problem = (section(text, "## Problem") ?? "").split("\n").filter((line) => line.trim() !== "");
  if (problem.length < 1 || problem.length > 3) {
    fail(`${name}: the problem takes ${problem.length} lines (want about two)`);
  }
  if (!/```[a-z]+\n/.test(section(text, "## Code") ?? "")) {
    fail(`${name}: no fenced code block in ## Code`);
  }
  if (!/^- /m.test(section(text, "## Traps") ?? "")) {
    fail(`${name}: no bullet in ## Traps`);
  }
  // Tool-neutral: Claude Code mechanics belong to SKILL.md's one paragraph.
  for (const word of ["CLAUDE_", "In Claude Code", "/plugin"]) {
    if (text.includes(word)) {
      fail(`${name}: mentions "${word}" (keep recipes tool-neutral)`);
    }
  }
  for (const pattern of MUST[name] ?? []) {
    if (!new RegExp(pattern).test(text)) {
      fail(`${name}: missing required content /${pattern}/`);
    }
  }
}

function checkGeneric(name, text) {
  for (const match of text.matchAll(/\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g)) {
    if (!ALLOWED_HOSTS.some((host) => host.test(match[1]))) {
      fail(`${name}: URL host "${match[1]}" is not generic (allowed: example.com, localhost, app.invalid)`);
    }
  }
  for (const match of text.matchAll(/[\w.+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) {
    if (!/(^|\.)example\.com$/.test(match[1])) {
      fail(`${name}: e-mail domain "${match[1]}" is not example.com`);
    }
  }
  for (const match of text.matchAll(/localhost:(\d{2,5})/g)) {
    if (match[1] !== "3000") {
      fail(`${name}: literal port ${match[1]} (use a variable or 3000)`);
    }
  }
  if (/\b(pkill|pgrep)\s+(-[a-zA-Z]*f\b|--full)/.test(text.replace(/never `?(pkill|pgrep) -f`?/gi, ""))) {
    fail(`${name}: contains a pkill -f or pgrep -f command`);
  }
  // Each backend domain lives in src/lib/apis/<domain>/, the only folder the structure check reads.
  for (const match of text.matchAll(/src\/lib\/(?:invoices|projects|members)\//g)) {
    fail(`${name}: domain path "${match[0]}" is outside src/lib/apis/<domain>/`);
  }
}

const MIN_CONTRAST = 4.5; // WCAG AA for body text

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** theme.md's role sheet: every literal colour of :root is set again in .dark, and each --on-X reads on --X. */
function checkPalette(text) {
  const css = /```css\n([\s\S]*?)```/.exec(text)?.[1] ?? "";
  const tokens = (selector) => {
    const body = new RegExp(`^${selector} \\{\\n([\\s\\S]*?)^\\}`, "m").exec(css)?.[1] ?? "";
    return Object.fromEntries([...body.matchAll(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{6});/gm)].map((m) => [m[1], m[2]]));
  };
  const modes = { light: tokens(":root"), dark: tokens("\\.dark") };
  if (Object.keys(modes.light).length === 0) {
    fail("theme.md: no literal #rrggbb colour token in the :root block");
    return;
  }
  for (const name of Object.keys(modes.light).filter((token) => !(token in modes.dark))) {
    fail(`theme.md: ${name} is set in :root but not in .dark`);
  }
  for (const [mode, set] of Object.entries(modes)) {
    for (const [name, value] of Object.entries(set).filter(([token]) => token.startsWith("--on-"))) {
      const base = name.replace(/^--on-/, "--");
      const [high, low] = [luminance(value), luminance(set[base] ?? value)].sort((x, y) => y - x);
      const ratio = (high + 0.05) / (low + 0.05);
      if (!set[base] || ratio < MIN_CONTRAST) {
        fail(`theme.md: ${name} on ${base} in ${mode} has contrast ${ratio.toFixed(2)} (want ${MIN_CONTRAST} or more)`);
      }
    }
  }
  ok(`theme.md palette: ${Object.keys(modes.light).length} literal tokens, dark parity and contrast`);
}

const files = readdirSync(dir).filter((file) => file.endsWith(".md")).sort();
const recipes = files.filter((file) => file !== "SKILL.md");
if (!files.includes("SKILL.md")) {
  fail("SKILL.md is missing");
} else {
  const index = readFileSync(join(dir, "SKILL.md"), "utf8");
  checkIndex(index);
  checkLinks(index, recipes);
  checkGeneric("SKILL.md", index);
}
if (expectFullSet) {
  const missing = Object.keys(MUST).filter((name) => !recipes.includes(name));
  missing.length ? fail(`recipes missing: ${missing.join(", ")}`) : ok(`all ${Object.keys(MUST).length} recipes present`);
}
for (const name of recipes) {
  const text = readFileSync(join(dir, name), "utf8");
  checkRecipe(name, text);
  checkGeneric(name, text);
  if (name === "theme.md") {
    checkPalette(text);
  }
}

console.log(failures === 0 ? "check-recipes: all checks passed" : `check-recipes: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
