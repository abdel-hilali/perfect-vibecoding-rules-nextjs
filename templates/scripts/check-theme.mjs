#!/usr/bin/env node
/**
 * Dark parity check for the theme stylesheet.
 *
 * Every colour token written as a LITERAL in `:root` (a hex, rgb(), oklch(),
 * a named colour...) must be redefined in `.dark`. Otherwise the dark theme
 * silently inherits the light value: one missing token once gave the dark
 * theme a white page. Aliases written with var() follow their source into
 * dark by construction, so only literals are held.
 *
 * Also flagged: a literal colour inside `@theme`. Tailwind turns it into a
 * utility that never changes with the theme. Declare the colour in `:root`
 * and `.dark`, and export it from `@theme` with var().
 *
 * A `:root` inside `@media (prefers-color-scheme: dark)` counts as the dark
 * sheet too: that is how a fresh create-next-app stylesheet switches.
 *
 * Usage: node scripts/check-theme.mjs [css-file]
 *   Default: src/app/globals.css, else app/globals.css. No dependencies; Node 18 or newer.
 */

import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const DEFAULT_PATHS = ["src/app/globals.css", "app/globals.css"];
// Selectors that open the light and the dark token blocks.
const LIGHT_SELECTORS = new Set([":root", ":root:not(.dark)", "html:not(.dark)"]);
const DARK_SELECTORS = new Set([".dark", ":root.dark", "html.dark"]);

const USAGE = "Usage: node scripts/check-theme.mjs [css-file]   (default: src/app/globals.css)";
const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
if (args.length > 1) {
  console.error(USAGE);
  process.exit(2);
}
const file = args[0] ?? DEFAULT_PATHS.find((path) => existsSync(path));
if (file === undefined || !existsSync(file)) {
  console.error(`No stylesheet at ${file ?? DEFAULT_PATHS.join(" or ")}.`);
  console.error(USAGE);
  process.exit(2);
}

const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred " +
    "darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink " +
    "deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold " +
    "goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush " +
    "lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
    "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow " +
    "lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise " +
    "palevioletred papayawhip peru pink plum powderblue purple rebeccapurple red rosybrown royalblue " +
    "saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow " +
    "springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);
const COLOUR_FUNCTION = /(^|[^\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX = /#[0-9a-f]{3,8}\b/i;

/** True when a value holds a colour written out, not taken from another token. */
function hasLiteralColour(raw) {
  // An image (url(...)) is not a colour token, whatever its data holds.
  const value = raw.replace(/url\([^)]*\)/g, " ");
  if (HEX.test(value) || COLOUR_FUNCTION.test(value)) {
    return true;
  }
  // Token names may contain colour words (--white-ish): drop them first.
  const words = value.replace(/--[\w-]+/g, " ").toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((word) => NAMED_COLOURS.has(word));
}

/**
 * Walks the stylesheet into rules: { selectors, declarations } for plain
 * rules, with nested at-rule bodies (@media, @layer, @supports) walked too.
 * `@theme` bodies are kept apart under the selector "@theme".
 */
function parse(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  // Inside @media (prefers-color-scheme: dark), a :root block is the dark sheet.
  const walk = (from, to, darkMedia = false) => {
    let start = from;
    let i = from;
    while (i < to) {
      const c = text[i];
      if (c === '"' || c === "'") {
        i = text.indexOf(c, i + 1) + 1 || to;
        continue;
      }
      if (c === ";") {
        start = i + 1;
      } else if (c === "{") {
        const prelude = text.slice(start, i).trim();
        let depth = 1;
        let end = i + 1;
        while (end < to && depth > 0) {
          depth += text[end] === "{" ? 1 : text[end] === "}" ? -1 : 0;
          end += 1;
        }
        const body = text.slice(i + 1, end - 1);
        if (/^@theme\b/.test(prelude)) {
          rules.push({ selectors: ["@theme"], declarations: declarations(body) });
        } else if (prelude.startsWith("@")) {
          walk(i + 1, end - 1, darkMedia || /prefers-color-scheme\s*:\s*dark/.test(prelude));
        } else {
          const selectors = prelude.split(",").map((s) => s.trim().replace(/\s+/g, " "));
          rules.push({
            selectors: darkMedia ? selectors.map((s) => (LIGHT_SELECTORS.has(s) ? ".dark" : s)) : selectors,
            declarations: declarations(body),
          });
        }
        i = end;
        start = end;
        continue;
      } else if (c === "}") {
        start = i + 1;
      }
      i += 1;
    }
  };
  walk(0, text.length);
  return rules;
}

/** Custom properties declared directly in a block body (nested blocks skipped). */
function declarations(body) {
  const flat = body.replace(/\{[^{}]*\}/g, ";");
  const found = new Map();
  for (const [, name, value] of flat.matchAll(/(--[\w-]+)\s*:\s*([^;]*)/g)) {
    found.set(name, value.trim());
  }
  return found;
}

const rules = parse(readFileSync(file, "utf8"));
const collect = (match) => {
  const all = new Map();
  for (const rule of rules.filter((r) => r.selectors.some(match))) {
    for (const [name, value] of rule.declarations) all.set(name, value);
  }
  return all;
};
const light = collect((s) => LIGHT_SELECTORS.has(s));
const dark = collect((s) => DARK_SELECTORS.has(s));
const theme = collect((s) => s === "@theme");

const literals = [...light].filter(([, value]) => hasLiteralColour(value)).map(([name]) => name);
const missing = literals.filter((name) => !dark.has(name));
const themeLiterals = [...theme].filter(([name, value]) => name.startsWith("--color-") && hasLiteralColour(value));

if (missing.length > 0 || themeLiterals.length > 0) {
  console.error(`\ntheme check failed: ${file}\n`);
  for (const name of missing) {
    console.error(`  ${name}: a literal colour in :root with no .dark value (the dark theme would show the light one)`);
  }
  for (const [name, value] of themeLiterals) {
    console.error(`  ${name}: ${value} is a literal colour in @theme; declare it in :root and .dark, export it with var()`);
  }
  console.error("");
  process.exit(1);
}
console.log(`theme check passed: ${literals.length} literal colour token(s) in :root, all redefined for the dark theme.`);
