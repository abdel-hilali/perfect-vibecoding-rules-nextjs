# Recipe: environment variables (schema-driven check, build vs runtime)

## Problem

`next build` inlines every `NEXT_PUBLIC_*` value into the bundle. A value missing at build time is baked in as
`undefined`, and the page quietly calls `undefined/...`. Supplying it later at runtime cannot fix that image.

## Rule

- Real values live in `.env` (local) and `.env.production` (server), both git-ignored via `.env*`, with the single
  exception `!.env.example`. The example holds placeholders only and documents every variable.
- `NEXT_PUBLIC_*` ships to every browser. It never carries a secret or an upstream URL.
- Server-only variables (`BACKEND_API_URL`, secrets) have no prefix, are read at request time, and are never
  printed or inlined.
- One schema-driven check, `scripts/check-env.mjs`: each variable declares its SCOPE (build or runtime), its KIND
  (how to validate it) and whether it is a secret. It runs on `prebuild`, and with `--strict` in CI and in the
  Docker builder.
- A Docker build passes each `NEXT_PUBLIC_*` as a build argument, in the builder stage.

## Code

```gitignore
# .gitignore
.env*
!.env.example
```

```bash
# .env.example (placeholders only; the only env file in git)
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_SITE_URL=https://app.example.com
NEXT_PUBLIC_WEBSOCKET_URL=wss://api.example.com
BACKEND_API_URL=https://api.example.com
```

```js
// scripts/check-env.mjs (no dependencies: it runs before anything else in a Docker builder)
import { readFileSync } from "node:fs";

const strict = process.argv.includes("--strict");

// This runs before Next loads .env files: read them, with Next's precedence (a real variable always wins).
for (const file of [".env.local", ".env.production", ".env"]) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
    if (match && !line.trimStart().startsWith("#") && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** scope: "build" is inlined by next build; "runtime" is read on the server and never required by a build. */
const SCHEMA = [
  { name: "NEXT_PUBLIC_API_BASE_URL", scope: "build", kind: "url-or-path", required: true },
  { name: "NEXT_PUBLIC_SITE_URL", scope: "build", kind: "origin", required: false },
  { name: "NEXT_PUBLIC_WEBSOCKET_URL", scope: "build", kind: "ws-url", required: false },
  { name: "BACKEND_API_URL", scope: "runtime", kind: "url", required: false },
  { name: "SESSION_SIGNING_SECRET", scope: "runtime", kind: "opaque", required: false, secret: true },
];

function problem({ name, kind, secret }, raw) {
  const shown = secret ? "<redacted>" : `"${raw}"`; // never print a secret
  if (kind === "opaque") {
    return null;
  }
  if (kind === "url-or-path" && raw.startsWith("/")) {
    return raw.length > 1 && raw.endsWith("/") ? `${name} must not end with a slash: ${shown}` : null;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return `${name} is not an absolute URL: ${shown}`;
  }
  const allowed = kind === "ws-url" ? ["ws:", "wss:"] : ["http:", "https:"];
  if (!allowed.includes(url.protocol)) {
    return `${name} must start with ${allowed.map((scheme) => `${scheme}//`).join(" or ")}: ${shown}`;
  }
  return kind === "origin" && raw.endsWith("/") ? `${name} must not end with a slash: ${shown}` : null;
}

const errors = [];
for (const entry of SCHEMA) {
  const raw = process.env[entry.name]?.trim();
  if (!raw) {
    const message = `${entry.name} is not set (inlined at build time)`;
    if (entry.required && entry.scope === "build" && strict) {
      errors.push(message);
    } else if (entry.required && entry.scope === "build") {
      console.warn(`warning: ${message}`);
    }
    continue;
  }
  const failure = problem(entry, raw);
  if (failure) {
    errors.push(failure);
  }
}
if (errors.length > 0) {
  console.error(`Environment check failed:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("Environment check passed.");
```

```json
{ "scripts": { "check:env": "node scripts/check-env.mjs", "prebuild": "node scripts/check-env.mjs" } }
```

```dockerfile
# Dockerfile, builder stage: every NEXT_PUBLIC_* is a build argument, documented here
ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN pnpm build
```

## Traps

- A runtime `env_file` cannot change a `NEXT_PUBLIC_*` value: the bundle was compiled with whatever the build saw.
- `.env*` in `.gitignore` also hides `.env.example` unless you add `!.env.example` after it.
- A trailing slash on an origin produces `//` in every canonical URL. The check refuses it.
- A malformed value is an error in BOTH modes. A missing required build value is a warning locally and an error
  with `--strict`, so a new developer is not blocked on day one.
- A server-only variable read in a module that a Client Component imports is `undefined` in the browser. Read it
  in `server-only` modules (`backendUrl()` in `api-relay.md`), and throw a clear error when it is missing.
