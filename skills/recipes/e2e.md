# Recipe: end-to-end tests (Playwright)

## Problem

E2E against `next dev` tests a different app: unminified, cached differently, with a different CSP.
Specs that depend on the machine (its language, colour scheme, network) are green locally and red in CI.

## Rule

- Run against a production build (`next build && next start`) that Playwright starts itself. Never `next dev`,
  never a server left over from earlier (`reuseExistingServer: false` for the app).
- Pin what the machine would decide: the locale (`locale` and `Accept-Language`) and the colour scheme.
- Fonts loaded from a third-party CDN at run time: record them once through one spec
  (`RECORD_FONTS=1 pnpm exec playwright test e2e/<one-spec>.spec.ts`; each engine writes its own HAR). Commit the
  whole `e2e/fixtures/` folder: the font files are saved beside the HAR files, which only point to them. Replay
  with `notFound: "fallback"`. Fonts from `next/font` are self-hosted: skip this.
- Writes run against a fixture API (a local mock of the backend), never a shared backend. A real-backend leg is
  READ-ONLY, targeted, one engine, and spaced out: login throttles are shared with real users.
- The E2E server takes the dev port. Say so to the owner before you start: "the site is down for N minutes".
- Run `build` BEFORE E2E, never straight after it: Playwright's web server builds into the same `.next`.
- Name the browser engines that can run on this machine, and report real numbers per engine.

## Code

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.DEV_PORT ?? 3000);
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 4100);
const REAL_BACKEND = process.env.E2E_BACKEND_URL; // set it for the read-only real-backend leg

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }, // the proxy negotiates the locale from it
    colorScheme: "light", // next-themes follows the OS under "system"
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
  webServer: [
    ...(REAL_BACKEND ? [] : [{
      command: "node scripts/fixture-api.mjs",
      url: `http://localhost:${FIXTURE_PORT}/health`,
      reuseExistingServer: true,
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
    }]),
    {
      command: "pnpm build && pnpm start",
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false, // an old server may 404 the new CSS hash and "fail" every layout spec
      timeout: 300_000,
      env: { PORT: String(PORT), NODE_ENV: "production",
        BACKEND_API_URL: REAL_BACKEND ?? `http://localhost:${FIXTURE_PORT}` },
    },
  ],
});
```

```ts
// e2e/test.ts (every spec imports test and expect from here)
import { existsSync } from "node:fs";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

/** Third-party fonts from a recording: a slow CDN would fail page.goto, which waits for `load`. */
export const test = base.extend<{ fonts: void }>({
  fonts: [
    async ({ context, browserName }, use) => {
      const har = path.join(__dirname, "fixtures", `fonts-${browserName}.har`);
      const record = process.env.RECORD_FONTS === "1";
      // Nothing recorded yet, or fonts are self-hosted (next/font): nothing to replay.
      if (record || existsSync(har)) {
        await context.routeFromHAR(har, {
          url: "**/fonts.g*/**",
          notFound: "fallback", // a new font version goes to the network instead of failing
          update: record,
        });
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
```

```ts
// e2e/filters.spec.ts (the gotchas in practice)
import { expect, test } from "./test";

test("a filter applies by itself and lives in the URL", async ({ page }) => {
  await page.goto("/en/invoices");
  await page.getByRole("combobox", { name: "Status" }).selectOption("PAID");
  await page.waitForURL((url) => url.searchParams.get("status") === "PAID"); // never networkidle plus a sleep
  await expect(page.getByRole("row")).not.toHaveCount(0);
});

test("an invitation link opens once per engine", async ({ page }, testInfo) => {
  // Single-use: the matrix runs this once per project, so the fixture seeds one token per project.
  await page.goto(`/en/invitation?token=invite-token-${testInfo.project.name}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a cleared session goes back to sign-in", async ({ page, context }) => {
  await page.goto("/en/dashboard"); // signed in through the project's storage state
  await page.waitForLoadState("networkidle"); // drain: a late Set-Cookie would resurrect a cleared cookie
  await context.clearCookies();
  await page.goto("/en/dashboard");
  await page.waitForURL(/\/en\/sign-in\?next=/);
});
```

## Traps

- `router.replace` can land a few seconds later. Wait for the URL (`page.waitForURL`), never a fixed sleep.
- `context.clearCookies()` races in-flight responses: a late `Set-Cookie` resurrects the cookie. Drain first.
- Single-use tokens burn per engine: the matrix runs a spec once per project. Seed one token per project.
- jsdom never fires `animationend` (unit tests): dispatch it yourself.
- A build started while Playwright's server is still tearing down fails with errors that look like real compile
  errors. Delete `.next` and rebuild to tell the two apart.
- `upgrade-insecure-requests` in the CSP makes WebKit rewrite `http://localhost` to https: no CSS, no JS, red specs.
  Leave it out; HSTS already covers production.
- Keep specs read-only by default. A spec that writes needs its own disposable data on the fixture API.
