import { afterEach, describe, expect, it, vi } from "vitest";

import { VELADESK_VERSION as importedVersion } from "./app-version";

describe("VELADESK_VERSION (apps/web/lib/app-version.ts)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads the build-time injected value, with a non-product fallback otherwise", () => {
    // No injection in the plain node test environment: the fallback makes
    // an unbuilt import visible instead of silently claiming a version.
    expect(importedVersion).toBe("0.0.0");
  });

  it("picks up NEXT_PUBLIC_VELADESK_VERSION exactly as injected by the build", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_VELADESK_VERSION", "9.9.9");
    const fresh = await import("./app-version");
    expect(fresh.VELADESK_VERSION).toBe("9.9.9");
  });
});
