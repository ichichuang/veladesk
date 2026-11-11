import { defineConfig, devices } from "@playwright/test";

/**
 * Interaction-fix browser suite (Chris t54 rework, 2026-11-10): REAL
 * behavior verification against the PRODUCTION standalone build —
 * pointer-driven drags with per-frame position recording, resize commits +
 * reload persistence, the always-visible section rail (no hover), and the
 * responsive viewport matrix. Evidence (screenshots + frame-sample JSON)
 * lands in the repo-root artifacts/interaction-fix/ directory, which is
 * gitignored.
 *
 * Prerequisite: `pnpm build` at the repo root produced apps/web/.next/standalone.
 * Run: cd apps/web && node_modules/.bin/playwright test -c playwright.interactions.config.ts
 *      (browsers resolve from PLAYWRIGHT_BROWSERS_PATH; the repo's
 *      @playwright/test pins its own browser revision)
 */
export default defineConfig({
  testDir: "./e2e/interaction-fix",
  outputDir: "../../artifacts/interaction-fix/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../artifacts/interaction-fix/report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3321",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    // VD_E2E_VIEWPORT_WIDTH/HEIGHT override the default viewport (t81): the
    // regression matrix runs the whole suite at several sizes, e.g.
    //   VD_E2E_VIEWPORT_WIDTH=1440 VD_E2E_VIEWPORT_HEIGHT=900
    viewport: {
      width: Number.parseInt(process.env.VD_E2E_VIEWPORT_WIDTH ?? "1280", 10),
      height: Number.parseInt(process.env.VD_E2E_VIEWPORT_HEIGHT ?? "720", 10),
    },
    actionTimeout: 15_000,
    launchOptions: process.env.VD_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.VD_PLAYWRIGHT_EXECUTABLE } : {},
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Same env override as the top level (project `use` would win).
        viewport: {
          width: Number.parseInt(process.env.VD_E2E_VIEWPORT_WIDTH ?? "1280", 10),
          height: Number.parseInt(process.env.VD_E2E_VIEWPORT_HEIGHT ?? "720", 10),
        },
      },
    },
  ],
  webServer: {
    command: "env PORT=3321 node ./scripts/e2e-standalone-server.mjs",
    url: "http://127.0.0.1:3321/api/v1/workspaces",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
