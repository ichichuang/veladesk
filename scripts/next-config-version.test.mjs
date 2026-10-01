import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Static contract for the web version injection (task 025 §10): the Next
 * config derives NEXT_PUBLIC_VELADESK_VERSION from the ROOT package.json
 * at build time — and reads nothing from the environment for it, so an
 * externally exported NEXT_PUBLIC_VELADESK_VERSION=9.9.9 can never
 * override the source version.
 */

const configSource = readFileSync(
  fileURLToPath(new URL("../apps/web/next.config.ts", import.meta.url)),
  "utf8",
);

const APP_VERSION_SOURCE = `export const VELADESK_VERSION`;

const appVersionSource = readFileSync(
  fileURLToPath(new URL("../apps/web/lib/app-version.ts", import.meta.url)),
  "utf8",
);

describe("web version injection contract (task 025 §10–§11)", () => {
  it("next.config.ts derives the version from the ROOT package.json", () => {
    expect(configSource).toMatch(/package\.json/);
    expect(configSource).toMatch(/repoRoot/);
    expect(configSource).toMatch(/veladeskVersion/);
  });

  it("injects NEXT_PUBLIC_VELADESK_VERSION from the derived value only", () => {
    expect(configSource).toMatch(/NEXT_PUBLIC_VELADESK_VERSION:\s*veladeskVersion/);
    // The config must never READ the env var — reading it would let the
    // environment override the single source of truth.
    expect(configSource).not.toMatch(/process\.env\.NEXT_PUBLIC_VELADESK_VERSION/);
  });

  it("apps/web exposes exactly one version helper and components use it", () => {
    expect(appVersionSource).toContain(APP_VERSION_SOURCE);
    const settingsSource = readFileSync(
      fileURLToPath(new URL("../apps/web/features/home/settings-center.tsx", import.meta.url)),
      "utf8",
    );
    expect(settingsSource).toMatch(/from "\.\.\/\.\.\/lib\/app-version"/);
    expect(settingsSource).not.toMatch(/process\.env\.NEXT_PUBLIC_VELADESK_VERSION/);
    void path;
  });

  it("the standalone output contract stays intact (task 025 §10 keep-list)", () => {
    for (const required of [
      /output:\s*"standalone"/,
      /outputFileTracingRoot/,
      /outputFileTracingIncludes/,
      /transpilePackages/,
      /allowedDevOrigins/,
    ]) {
      expect(configSource).toMatch(required);
    }
  });
});
