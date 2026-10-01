import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  compareVersions,
  isValidVersion,
  listVelaDeskManifestPaths,
  parseVersion,
  readRootVersion,
} from "./version-lib.mjs";
import { cleanupFixture, makeVersionFixture } from "./test-fixtures.mjs";

const fixtures = [];
afterEach(() => {
  while (fixtures.length > 0) {
    cleanupFixture(fixtures.pop());
  }
});

describe("isValidVersion (plain SemVer only)", () => {
  it.each(["0.1.0", "1.0.0", "1.0.1", "1.1.0", "2.0.0", "0.0.1", "10.20.30"])(
    "accepts %s",
    (version) => {
      expect(isValidVersion(version)).toBe(true);
    },
  );

  it.each([
    "v1.0.0",
    "01.0.0",
    "1",
    "1.0",
    "1.0.0-beta",
    "1.0.0-preview",
    "1.0.0-alpha",
    "1.0.0-rc.1",
    "1.0.0+build",
    "abc",
    "",
    " 1.0.0",
    "1.0.0 ",
    "1.0.0.0",
  ])("rejects %s", (version) => {
    expect(isValidVersion(version)).toBe(false);
  });

  it("rejects non-strings without throwing", () => {
    expect(isValidVersion(null)).toBe(false);
    expect(isValidVersion(undefined)).toBe(false);
    expect(isValidVersion(1)).toBe(false);
  });
});

describe("parseVersion", () => {
  it("splits into numeric components", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("0.0.1")).toEqual({ major: 0, minor: 0, patch: 1 });
  });

  it("returns null for invalid input", () => {
    expect(parseVersion("v1.0.0")).toBeNull();
    expect(parseVersion("1.0")).toBeNull();
    expect(parseVersion("1.0.0-beta")).toBeNull();
  });
});

describe("compareVersions (numeric, never lexical)", () => {
  it("compares numerically across magnitudes", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.9.9", "1.10.0")).toBe(-1);
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
  });

  it("returns 0 for equality", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("throws on invalid operands", () => {
    expect(() => compareVersions("v1.0.0", "1.0.0")).toThrow();
    expect(() => compareVersions("1.0.0", "abc")).toThrow();
  });
});

describe("readRootVersion", () => {
  it("reads the root manifest's version", () => {
    const rootDir = makeVersionFixture({ version: "0.7.3" });
    fixtures.push(rootDir);
    expect(readRootVersion(rootDir)).toBe("0.7.3");
  });

  it("throws a descriptive error for a missing manifest", () => {
    const rootDir = makeVersionFixture();
    fixtures.push(rootDir);
    expect(() => readRootVersion(path.join(rootDir, "nowhere"))).toThrow(/package\.json/);
  });

  it("throws when the root version is not valid SemVer", () => {
    const rootDir = makeVersionFixture();
    fixtures.push(rootDir);
    const manifest = path.join(rootDir, "package.json");
    const parsed = JSON.parse(readFileSync(manifest, "utf8"));
    parsed.version = "1.0";
    writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    expect(() => readRootVersion(rootDir)).toThrow(/1\.0/);
  });
});

describe("listVelaDeskManifestPaths (dynamic scan)", () => {
  it("finds the root, apps/* and packages/* manifests dynamically", () => {
    const rootDir = makeVersionFixture();
    fixtures.push(rootDir);
    const paths = listVelaDeskManifestPaths(rootDir).map((absolute) => path.relative(rootDir, absolute));
    expect(paths).toEqual([
      path.join("package.json"),
      path.join("apps", "web", "package.json"),
      path.join("packages", "assets", "package.json"),
      path.join("packages", "domain", "package.json"),
    ]);
  });

  it("does not hardcode the current repository shape", () => {
    const rootDir = makeVersionFixture();
    fixtures.push(rootDir);
    // A brand-new package shows up without any script change.
    const extra = path.join(rootDir, "packages", "brand-new-thing", "package.json");
    const parsed = JSON.parse(readFileSync(path.join(rootDir, "packages", "domain", "package.json"), "utf8"));
    mkdirSync(path.dirname(extra), { recursive: true });
    writeFileSync(extra, `${JSON.stringify({ ...parsed, name: "@veladesk/brand-new-thing" }, null, 2)}\n`, "utf8");
    const paths = listVelaDeskManifestPaths(rootDir).map((absolute) => path.relative(rootDir, absolute));
    expect(paths).toContain(path.join("packages", "brand-new-thing", "package.json"));
  });
});
