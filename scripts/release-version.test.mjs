import { describe, expect, it } from "vitest";

import { decideDispatchRelease, decideRelease } from "./release-version.mjs";

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

describe("decideDispatchRelease (027-R1 §9–§11 — the recovery entry)", () => {
  it("dispatch of the current UNRELEASED version with tag and release absent → release it", () => {
    expect(
      decideDispatchRelease({ currentVersion: "1.0.0", existingTag: false, existingRelease: false }),
    ).toEqual({
      shouldRelease: true,
      reason: "dispatch-retry",
      version: "1.0.0",
      tag: "v1.0.0",
    });
  });

  it("fails when the tag already exists — never re-issue a published version", () => {
    expect(() =>
      decideDispatchRelease({ currentVersion: "1.0.0", existingTag: true, existingRelease: false }),
    ).toThrow(/tag v1\.0\.0 already exists/);
  });

  it("fails when the GitHub Release already exists even if the tag is somehow absent", () => {
    expect(() =>
      decideDispatchRelease({ currentVersion: "1.0.0", existingTag: false, existingRelease: true }),
    ).toThrow(/release v1\.0\.0 already exists/);
  });

  it("fails on an invalid version", () => {
    expect(() =>
      decideDispatchRelease({ currentVersion: "not-semver", existingTag: false, existingRelease: false }),
    ).toThrow(/invalid current version/);
  });
});

describe("push semantics are unchanged by the dispatch mode (027-R1 §10)", () => {
  it("a normal version-CHANGING push still releases (0.1.0 → 1.0.0)", () => {
    const decision = decideRelease({ previousVersion: "0.1.0", currentVersion: "1.0.0", existingTag: false });
    expect(decision.shouldRelease).toBe(true);
    expect(decision.reason).toBe("release");
    expect(decision.tag).toBe("v1.0.0");
  });

  it("a normal UNCHANGED-version push still releases nothing (1.0.0 → 1.0.0)", () => {
    const decision = decideRelease({ previousVersion: "1.0.0", currentVersion: "1.0.0", existingTag: false });
    expect(decision.shouldRelease).toBe(false);
    expect(decision.reason).toBe("unchanged");
  });
});

describe("release-version CLI dispatch mode (027-R1 §11)", () => {
  it("dispatch prints a decision line and exits 0 for the absent tag/release case", async () => {
    const { exitCode, stdout } = await runCli(["dispatch", "1.0.0", "false", "false"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"shouldRelease":true');
    expect(stdout).toContain('"tag":"v1.0.0"');
    expect(stdout).toContain("Dispatch recovery");
  });

  it("dispatch with an existing tag fails with exit 1", async () => {
    const { exitCode, stderr } = await runCli(["dispatch", "1.0.0", "true", "false"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("already exists");
  });

  it("the PUSH invocation keeps its original usage error (no dispatch arg)", async () => {
    const { exitCode, stderr } = await runCli(["1.0.0"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });
});

async function runCli(args) {
  const { spawn } = await import("node:child_process");
  const scriptPath = new URL("./release-version.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [scriptPath, ...args]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
  return { exitCode, stdout, stderr };
}
