import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkAllVersions } from "./check-version.mjs";
import { cleanupFixture, makeVersionFixture } from "./test-fixtures.mjs";

const fixtures = [];
afterEach(() => {
  while (fixtures.length > 0) {
    cleanupFixture(fixtures.pop());
  }
});

describe("checkAllVersions (pnpm version:check core)", () => {
  it("passes when every manifest matches the root version", () => {
    const rootDir = makeVersionFixture({ version: "0.5.1" });
    fixtures.push(rootDir);
    const result = checkAllVersions(rootDir);
    expect(result.ok).toBe(true);
    expect(result.version).toBe("0.5.1");
    expect(result.checked).toBe(4);
    expect(result.mismatches).toEqual([]);
  });

  it("reports exactly which manifest drifted and to what", () => {
    const rootDir = makeVersionFixture({ version: "1.1.0" });
    fixtures.push(rootDir);
    const drifted = path.join(rootDir, "packages", "domain", "package.json");
    const parsed = JSON.parse(readFileSync(drifted, "utf8"));
    parsed.version = "1.0.0";
    writeFileSync(drifted, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const result = checkAllVersions(rootDir);
    expect(result.ok).toBe(false);
    expect(result.version).toBe("1.1.0");
    expect(result.mismatches).toEqual([{ path: drifted, version: "1.0.0" }]);
    expect(path.relative(rootDir, result.mismatches[0].path)).toBe(path.join("packages", "domain", "package.json"));
  });

  it("fails when the root version itself is invalid", () => {
    const rootDir = makeVersionFixture();
    fixtures.push(rootDir);
    const rootManifest = path.join(rootDir, "package.json");
    const parsed = JSON.parse(readFileSync(rootManifest, "utf8"));
    parsed.version = "not-semver";
    writeFileSync(rootManifest, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const result = checkAllVersions(rootDir);
    expect(result.ok).toBe(false);
  });

  it("never modifies files", () => {
    const rootDir = makeVersionFixture({ version: "0.9.0" });
    fixtures.push(rootDir);
    const drifted = path.join(rootDir, "apps", "web", "package.json");
    const parsed = JSON.parse(readFileSync(drifted, "utf8"));
    parsed.version = "0.1.0";
    writeFileSync(drifted, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    const before = readFileSync(drifted, "utf8");

    checkAllVersions(rootDir);
    expect(readFileSync(drifted, "utf8")).toBe(before);
  });
});
