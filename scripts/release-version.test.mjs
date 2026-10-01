import { describe, expect, it } from "vitest";

import { decideRelease } from "./release-version.mjs";

describe("decideRelease (task 025 §17–§19, §50)", () => {
  it("dependency-only package.json changes (version unchanged) release nothing", () => {
    expect(decideRelease({ previousVersion: "1.0.0", currentVersion: "1.0.0", existingTag: false })).toEqual({
      shouldRelease: false,
      reason: "unchanged",
      version: "1.0.0",
      tag: "v1.0.0",
    });
  });

  it.each([
    ["1.0.0", "1.0.1"],
    ["1.0.1", "1.1.0"],
    ["1.1.0", "2.0.0"],
    ["1.2.0", "1.4.0"],
    ["0.1.0", "0.1.1"],
  ])("releases %s -> %s", (previousVersion, currentVersion) => {
    const decision = decideRelease({ previousVersion, currentVersion, existingTag: false });
    expect(decision.shouldRelease).toBe(true);
    expect(decision.reason).toBe("release");
    expect(decision.version).toBe(currentVersion);
    expect(decision.tag).toBe(`v${currentVersion}`);
  });

  it("releases the first version when no previous exists", () => {
    const decision = decideRelease({ previousVersion: null, currentVersion: "0.1.0", existingTag: false });
    expect(decision.shouldRelease).toBe(true);
    expect(decision.tag).toBe("v0.1.0");
  });

  it.each([
    ["1.2.0", "1.1.9"],
    ["2.0.0", "1.9.9"],
    ["1.0.0", "0.9.9"],
  ])("fails on version regression %s -> %s", (previousVersion, currentVersion) => {
    expect(() => decideRelease({ previousVersion, currentVersion, existingTag: false })).toThrow(
      /backwards|regress/i,
    );
  });

  it("fails on an invalid current version", () => {
    expect(() => decideRelease({ previousVersion: "1.0.0", currentVersion: "v2.0.0", existingTag: false })).toThrow(
      /invalid/i,
    );
    expect(() => decideRelease({ previousVersion: "1.0.0", currentVersion: "1.0.0-beta", existingTag: false })).toThrow(
      /invalid/i,
    );
  });

  it("fails when the target tag already exists (a published version is never overwritten)", () => {
    expect(() => decideRelease({ previousVersion: "1.0.0", currentVersion: "1.1.0", existingTag: true })).toThrow(
      /tag/i,
    );
    // Even an unchanged version with an existing tag stays a failure, not a release.
    expect(() => decideRelease({ previousVersion: "1.0.0", currentVersion: "1.0.0", existingTag: true })).toThrow(
      /tag/i,
    );
  });

  it("fails on an invalid previous version", () => {
    expect(() => decideRelease({ previousVersion: "nope", currentVersion: "1.0.0", existingTag: false })).toThrow(
      /invalid/i,
    );
  });
});
