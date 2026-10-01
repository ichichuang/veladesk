import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { applyVersionToRoot } from "./set-version.mjs";
import { cleanupFixture, makeVersionFixture } from "./test-fixtures.mjs";

const fixtures = [];
afterEach(() => {
  while (fixtures.length > 0) {
    cleanupFixture(fixtures.pop());
  }
});

describe("applyVersionToRoot (pnpm version:set core)", () => {
  it("syncs every VelaDesk manifest to the new version", () => {
    const rootDir = makeVersionFixture({ version: "0.1.0" });
    fixtures.push(rootDir);
    const result = applyVersionToRoot(rootDir, "1.2.0");
    expect(result.version).toBe("1.2.0");
    expect(result.updated).toHaveLength(4);
    for (const manifest of result.updated) {
      expect(JSON.parse(readFileSync(manifest, "utf8")).version).toBe("1.2.0");
    }
    expect(JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")).version).toBe("1.2.0");
  });

  it("changes ONLY the version field — deps, workspace:* and other fields survive", () => {
    const rootDir = makeVersionFixture();
    fixtures.push(rootDir);
    const webManifest = path.join(rootDir, "apps", "web", "package.json");
    const before = JSON.parse(readFileSync(webManifest, "utf8"));
    applyVersionToRoot(rootDir, "2.3.4");
    const after = JSON.parse(readFileSync(webManifest, "utf8"));
    expect(after.name).toBe(before.name);
    expect(after.dependencies).toEqual(before.dependencies);
    expect(after.dependencies["@veladesk/domain"]).toBe("workspace:*");
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  it("preserves the 2-space JSON formatting and the trailing newline", () => {
    const rootDir = makeVersionFixture();
    fixtures.push(rootDir);
    const manifest = path.join(rootDir, "packages", "domain", "package.json");
    const before = readFileSync(manifest, "utf8");
    applyVersionToRoot(rootDir, "0.2.0");
    const after = readFileSync(manifest, "utf8");
    expect(after.endsWith("\n")).toBe(before.endsWith("\n"));
    expect(after).toMatch(/^  "name": "@veladesk\/domain",$/m);
    expect(after).toMatch(/^  "version": "0\.2\.0",?$/m);
    // Exactly the version line changed.
    expect(after.replace(/"version": "[^"]+"/, '"version": "X"')).toBe(
      before.replace(/"version": "[^"]+"/, '"version": "X"'),
    );
  });

  it("rejects an invalid version without touching any file", () => {
    const rootDir = makeVersionFixture({ version: "0.1.0" });
    fixtures.push(rootDir);
    const before = readFileSync(path.join(rootDir, "package.json"), "utf8");
    expect(() => applyVersionToRoot(rootDir, "v1.0.0")).toThrow();
    expect(() => applyVersionToRoot(rootDir, "1.0.0-beta")).toThrow();
    expect(readFileSync(path.join(rootDir, "package.json"), "utf8")).toBe(before);
  });
});
