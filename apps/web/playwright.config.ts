import { defineConfig, devices } from "@playwright/test";

/**
 * Task 018 browser suite: runs against the PRODUCTION standalone build.
 *
 * The webServer script copies .next/static + public into the standalone
 * tree, uses an isolated temp data dir, and terminates only the process it
 * owns. Evidence (screenshots / videos / traces / HTML report) lands in
 * the repo-root artifacts/task-018/ directory, which is gitignored — see
 * the task 018 contract: never committed, never deleted before reporting.
 *
 * Prerequisite: `pnpm build` (repo root) must have produced
 * apps/web/.next/standalone first.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../artifacts/task-018/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "../../artifacts/task-018/report",
        open: "never",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:3131",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node ./scripts/e2e-standalone-server.mjs",
    url: "http://127.0.0.1:3131/api/v1/workspaces",
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
