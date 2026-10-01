import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectTreeLinks, linkViolations } from "./inspect-runtime-links.mjs";

const fixtures = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

function writeFile(file, content = "x") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

describe("inspectTreeLinks (task 027-R2 evidence + gates)", () => {
  it("classifies internal relative, absolute-external and dangling links", () => {
    const root = makeTempDir("veladesk-inspect-");
    writeFile(path.join(root, "node_modules/.pnpm/react@19.3.0/node_modules/react/index.js"));
    writeFile(path.join(root, "apps/web/server.js"));
    const linkParent = path.join(root, "node_modules/.pnpm/next@16.3.5_fake/node_modules");
    mkdirSync(linkParent, { recursive: true });
    symlinkSync("../../react@19.3.0/node_modules/react", path.join(linkParent, "react"), "dir");
    symlinkSync("/absolute/path/outside", path.join(linkParent, "absolute-one"), "dir");
    symlinkSync("../../missing@1.0.0/node_modules/missing", path.join(linkParent, "dangling-one"), "dir");

    const { links, total } = inspectTreeLinks({ root });
    expect(total).toBe(3);

    const internal = links.find((link) => link.path.endsWith("react"));
    expect(internal.targetKind).toBe("relative");
    expect(internal.resolves).toBe(true);
    expect(internal.insideRoot).toBe(true);

    const absolute = links.find((link) => link.path.endsWith("absolute-one"));
    expect(absolute.targetKind).toBe("absolute");
    expect(absolute.insideRoot).toBe(false);

    const dangling = links.find((link) => link.path.endsWith("dangling-one"));
    expect(dangling.resolves).toBe(false);
  });

  it("bounds reported links to --limit while counting the true total", () => {
    const root = makeTempDir("veladesk-inspect-");
    mkdirSync(path.join(root, "many"), { recursive: true });
    writeFile(path.join(root, "many/anchor.txt"));
    for (let index = 0; index < 5; index += 1) {
      symlinkSync("anchor.txt", path.join(root, "many", `link-${index}`), "file");
    }
    const { links, total } = inspectTreeLinks({ root, limit: 2 });
    expect(total).toBe(5);
    expect(links).toHaveLength(2);
  });

  it("gates: --expect none rejects any link; internal-only rejects absolute/dangling/outside", () => {
    const good = makeTempDir("veladesk-inspect-good-");
    writeFile(path.join(good, "node_modules/.pnpm/react@19.3.0/node_modules/react/index.js"));
    mkdirSync(path.join(good, "node_modules/.pnpm/next@1/node_modules"), { recursive: true });
    symlinkSync("../../react@19.3.0/node_modules/react", path.join(good, "node_modules/.pnpm/next@1/node_modules/react"), "dir");
    const goodInspection = inspectTreeLinks({ root: good });
    expect(linkViolations({ links: goodInspection.links, expect: "internal-only" })).toEqual([]);
    expect(linkViolations({ links: goodInspection.links, expect: "none" }).length).toBe(1);

    const bad = makeTempDir("veladesk-inspect-bad-");
    mkdirSync(path.join(bad, "node_modules"), { recursive: true });
    symlinkSync("/checkout/node_modules/react", path.join(bad, "node_modules/react"), "dir");
    const badInspection = inspectTreeLinks({ root: bad });
    const violations = linkViolations({ links: badInspection.links, expect: "internal-only" });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("node_modules/react");
    expect(violations[0]).toContain("/checkout/node_modules/react");
  });
});
