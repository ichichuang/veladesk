import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertRuntimeLinkPolicy,
  collectTreeInventory,
  compareInventories,
  stageRuntimeTree,
} from "./runtime-stage.mjs";

/**
 * Task 027-R2 fixtures: link-bearing standalone trees staged inside
 * test-owned temp directories. Everything here runs on non-Windows local
 * machines and CI; actual junction/reparse behavior is exercised by the same
 * module on GitHub Windows runners via release.yml.
 */

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

function readText(file) {
  return readFileSync(file, "utf8");
}

/** A miniature standalone tree: real packages + pnpm-style links. */
function makeStandaloneFixture() {
  const root = makeTempDir("veladesk-stage-src-");
  writeFile(path.join(root, "apps/web/server.js"), "// server\n");
  writeFile(path.join(root, "node_modules/.pnpm/react@19.3.0/node_modules/react/index.js"), "react-main");
  writeFile(path.join(root, "node_modules/.pnpm/react@19.3.0/node_modules/react/package.json"), '{"name":"react"}');
  writeFile(path.join(root, "node_modules/.pnpm/next@16.3.5_fake/node_modules/next/index.js"), "next-main");
  writeFile(path.join(root, "node_modules/.pnpm/next@16.3.5_fake/node_modules/next/dist/require-hook.js"), "hook");
  writeFile(path.join(root, "node_modules/.pnpm/semver@6.3.1/node_modules/semver/index.js"), "semver6");
  writeFile(path.join(root, "packages/database/drizzle/0000_init.sql"), "-- init\n");
  writeFile(path.join(root, "packages/database/drizzle/meta/_journal.json"), "[]");
  writeFile(path.join(root, "node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/build/Release/better_sqlite3.node"), "\0node\0");
  // Hidden dotfile inside a dot-directory — must survive staging byte-identically.
  writeFile(path.join(root, "apps/web/.next/cache/hidden-marker"), "dot");
  // pnpm isolated-layout style links (as seen in real standalone output):
  // relative links inside the tree.
  mkdirSync(path.join(root, "node_modules/.pnpm/next@16.3.5_fake/node_modules"), { recursive: true });
  symlinkSync("../../react@19.3.0/node_modules/react", path.join(root, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react"), "dir");
  mkdirSync(path.join(root, "node_modules/.pnpm/node_modules"), { recursive: true });
  symlinkSync("../semver@6.3.1/node_modules/semver", path.join(root, "node_modules/.pnpm/node_modules/semver"), "dir");
  return root;
}

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

describe("stageRuntimeTree — unix policy (preserve internal relative links)", () => {
  it("stages every file byte-identically, including dot-directories and .node files", () => {
    const source = makeStandaloneFixture();
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");
    const result = stageRuntimeTree({ source, destination, platform: "linux" });

    expect(readText(path.join(destination, "apps/web/server.js"))).toBe("// server\n");
    expect(readText(path.join(destination, "apps/web/.next/cache/hidden-marker"))).toBe("dot");
    expect(
      readText(path.join(destination, "node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/build/Release/better_sqlite3.node")),
    ).toBe("\0node\0");
    expect(result.links.some((link) => link.action === "preserved")).toBe(true);
  });

  it("preserves internal relative links as the same relative targets", () => {
    const source = makeStandaloneFixture();
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");
    stageRuntimeTree({ source, destination, platform: "linux" });

    const stagedLink = path.join(destination, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react");
    expect(lstatSync(stagedLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(stagedLink)).toBe("../../react@19.3.0/node_modules/react");
    // And it still resolves INSIDE the staged tree…
    expect(existsSync(stagedLink)).toBe(true);
  });

  it("produces a tree that keeps resolving after the SOURCE tree is deleted (relocation)", () => {
    const source = makeStandaloneFixture();
    const parent = makeTempDir("veladesk-stage-dst-");
    const destination = path.join(parent, "runtime");
    stageRuntimeTree({ source, destination, platform: "linux" });

    rmSync(source, { recursive: true, force: true });
    const stagedLink = path.join(destination, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react");
    expect(existsSync(stagedLink)).toBe(true);
    expect(existsSync(path.join(stagedLink, "index.js"))).toBe(true);
  });

  it("rejects a dangling link with the exact offending path", () => {
    const source = makeStandaloneFixture();
    symlinkSync("../../gone@1.0.0/node_modules/gone", path.join(source, "node_modules/.pnpm/next@16.3.5_fake/node_modules/gone"), "dir");
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");

    let error;
    try {
      stageRuntimeTree({ source, destination, platform: "linux" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/dangling/i);
    expect(error.message).toContain(path.join("next@16.3.5_fake", "node_modules", "gone"));
  });

  it("rejects a relative link escaping the source root", () => {
    const source = makeStandaloneFixture();
    symlinkSync("../../../../../../outside", path.join(source, "node_modules/.pnpm/node_modules/escape"), "dir");
    const outside = path.join(path.dirname(source), "outside");
    writeFile(path.join(outside, "payload.js"), "stolen");
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");

    expect(() => stageRuntimeTree({ source, destination, platform: "linux" })).toThrow(/escape/);
  });

  it("rejects an ABSOLUTE external link — the 027 Windows junction class", () => {
    const source = makeStandaloneFixture();
    const external = makeTempDir("veladesk-external-");
    writeFile(path.join(external, "checkout/node_modules/.pnpm/react@19.3.0/node_modules/react/index.js"), "react-copy");
    symlinkSync(
      path.join(external, "checkout/node_modules/.pnpm/react@19.3.0/node_modules/react"),
      path.join(source, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react-absolute"),
      "dir",
    );
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");

    // Even though the target EXISTS (like on the build runner's checkout),
    // an absolute link out of the tree is rejected with its exact path.
    let error;
    try {
      stageRuntimeTree({ source, destination, platform: "linux" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("react-absolute");
    expect(error.message).toContain("absolute");
  });

  it("rejects a link chain that loops back onto itself (unix)", () => {
    const source = makeStandaloneFixture();
    mkdirSync(path.join(source, "cycle"), { recursive: true });
    symlinkSync("second-link", path.join(source, "cycle/first-link"), "file");
    symlinkSync("first-link", path.join(source, "cycle/second-link"), "file");
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");

    let error;
    try {
      stageRuntimeTree({ source, destination, platform: "linux" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/cyclic link chain/);
    expect(error.message).toContain("first-link");
  });

  it("rejects mutual directory links under the win32 materializer (copy recursion cycle)", () => {
    const source = makeStandaloneFixture();
    writeFile(path.join(source, "cycle/a/real.txt"), "a");
    writeFile(path.join(source, "cycle/b/real.txt"), "b");
    symlinkSync("../b", path.join(source, "cycle/a/loop"), "dir");
    symlinkSync("../a", path.join(source, "cycle/b/loop"), "dir");
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");

    let error;
    try {
      stageRuntimeTree({ source, destination, platform: "win32" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/cyclic/);
    expect(error.message).toContain("loop");
  });

  it("rejects staging a directory into itself", () => {
    const source = makeStandaloneFixture();
    const destination = path.join(source, "self-copy");
    expect(() => stageRuntimeTree({ source, destination, platform: "linux" })).toThrow(/into itself/);
  });

  it("fails when expansion exceeds the entry budget", () => {
    const source = makeStandaloneFixture();
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");
    expect(() => stageRuntimeTree({ source, destination, platform: "linux", maxEntries: 5 })).toThrow(/excessive/);
  });
});

describe("stageRuntimeTree — win32 policy (no links in the final package)", () => {
  it("materializes internal relative links into real directories", () => {
    const source = makeStandaloneFixture();
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");
    stageRuntimeTree({ source, destination, platform: "win32" });

    const staged = path.join(destination, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react");
    expect(lstatSync(staged).isSymbolicLink()).toBe(false);
    expect(lstatSync(staged).isDirectory()).toBe(true);
    expect(readText(path.join(staged, "index.js"))).toBe("react-main");
    // No link of any kind survives into the win32 package.
    const inventory = collectTreeInventory(destination);
    expect(inventory.links.size).toBe(0);
  });

  it("rejects an absolute external link on win32 instead of guessing a mapping", () => {
    const source = makeStandaloneFixture();
    const external = makeTempDir("veladesk-external-");
    writeFile(path.join(external, "checkout/node_modules/.pnpm/react@19.3.0/node_modules/react/index.js"), "react-copy");
    symlinkSync(
      path.join(external, "checkout/node_modules/.pnpm/react@19.3.0/node_modules/react"),
      path.join(source, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react-absolute"),
      "dir",
    );
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");

    expect(() => stageRuntimeTree({ source, destination, platform: "win32" })).toThrow(/react-absolute/);
  });
});

describe("stageRuntimeTree — verified-twin reconstruction of out-of-tree links (turbopack marker class)", () => {
  /**
   * The shape seen on the Windows runner: an ABSOLUTE junction at
   * apps/web/.next/node_modules/<marker> -> <checkout>/node_modules/<pkg>,
   * while the SAME package is traced into the tree as a real directory. The
   * standalone source is nested at its real tracing position inside a
   * dedicated checkout root so the mapping geometry is the runner's.
   */
  function makeMarkerFixture() {
    const holder = makeTempDir("veladesk-recon-");
    const checkoutRoot = path.join(holder, "checkout");
    const source = path.join(checkoutRoot, "apps", "web", ".next", "standalone");
    writeFile(path.join(source, "apps/web/server.js"), "// server\n");
    writeFile(path.join(source, "node_modules/better-sqlite3/package.json"), '{"name":"better-sqlite3"}');
    writeFile(path.join(source, "node_modules/better-sqlite3/build/Release/better_sqlite3.node"), "\0node\0");
    const checkoutPackage = path.join(checkoutRoot, "node_modules", "better-sqlite3");
    writeFile(path.join(checkoutPackage, "package.json"), '{"name":"better-sqlite3"}');
    writeFile(path.join(checkoutPackage, "build/Release/better_sqlite3.node"), "\0node\0");
    mkdirSync(path.join(source, "apps/web/.next/node_modules"), { recursive: true });
    symlinkSync(checkoutPackage, path.join(source, "apps/web/.next/node_modules/better-sqlite3-90e2652d1716b047"), "dir");
    return { source, checkoutRoot };
  }

  it("unix: rewrites the marker as a RELATIVE link to the in-bundle twin", () => {
    const { source, checkoutRoot } = makeMarkerFixture();
    const parent = makeTempDir("veladesk-stage-dst-");
    const destination = path.join(parent, "runtime");
    const result = stageRuntimeTree({ source, destination, platform: "linux", allowedExternalRoot: checkoutRoot });

    const marker = path.join(destination, "apps/web/.next/node_modules/better-sqlite3-90e2652d1716b047");
    expect(lstatSync(marker).isSymbolicLink()).toBe(true);
    const rewritten = readlinkSync(marker);
    expect(path.isAbsolute(rewritten)).toBe(false);
    // …and it resolves INSIDE the staged tree (to the traced twin).
    expect(existsSync(path.join(marker, "package.json"))).toBe(true);
    const reconstruction = result.links.find((link) => link.action === "reconstructed");
    expect(reconstruction?.path.endsWith("better-sqlite3-90e2652d1716b047")).toBe(true);
  });

  it("win32: materializes the marker from the in-bundle twin (package stays link-free)", () => {
    const { source, checkoutRoot } = makeMarkerFixture();
    const parent = makeTempDir("veladesk-stage-dst-");
    const destination = path.join(parent, "runtime");
    stageRuntimeTree({ source, destination, platform: "win32", allowedExternalRoot: checkoutRoot });

    const marker = path.join(destination, "apps/web/.next/node_modules/better-sqlite3-90e2652d1716b047");
    expect(lstatSync(marker).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(marker, "build", "Release", "better_sqlite3.node"))).toBe(true);
    expect(collectTreeInventory(destination).links.size).toBe(0);
  });

  it("still rejects an out-of-tree link with NO verifiable in-bundle twin (no name guessing)", () => {
    const holder = makeTempDir("veladesk-recon-");
    const checkoutRoot = path.join(holder, "checkout");
    const source = path.join(checkoutRoot, "apps", "web", ".next", "standalone");
    writeFile(path.join(source, "apps/web/server.js"), "// server\n");
    // Present in the checkout, ABSENT from the bundle: the mapping cannot be
    // verified, so it must fail with the exact path.
    writeFile(path.join(checkoutRoot, "node_modules/untraced-pkg/index.js"), "x");
    mkdirSync(path.join(source, "apps/web/.next/node_modules"), { recursive: true });
    symlinkSync(
      path.join(checkoutRoot, "node_modules", "untraced-pkg"),
      path.join(source, "apps/web/.next/node_modules/untraced-pkg-marker"),
      "dir",
    );
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");

    let error;
    try {
      stageRuntimeTree({ source, destination, platform: "linux", allowedExternalRoot: checkoutRoot });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/absolute\/escaping link rejected/);
    expect(error.message).toContain("untraced-pkg-marker");
  });

  it("still rejects out-of-tree links entirely when no external root is trusted", () => {
    const { source } = makeMarkerFixture();
    const destination = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");
    let error;
    try {
      stageRuntimeTree({ source, destination, platform: "linux" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/absolute\/escaping link rejected/);
  });
});

describe("inventory, policy and comparison", () => {
  it("collects files with sha256 hashes, links with raw targets, and directories", () => {
    const source = makeStandaloneFixture();
    const inventory = collectTreeInventory(source);
    expect(inventory.files.size).toBeGreaterThan(5);
    expect(inventory.links.get("node_modules/.pnpm/next@16.3.5_fake/node_modules/react")).toBe(
      "../../react@19.3.0/node_modules/react",
    );
    expect(inventory.dirs).toContain("apps/web/.next/cache");
    const hash = inventory.files.get("apps/web/server.js");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("assertRuntimeLinkPolicy accepts internal relative links on unix and rejects all on win32", () => {
    const tree = makeStandaloneFixture();
    const inventory = collectTreeInventory(tree);
    expect(assertRuntimeLinkPolicy(inventory, { platform: "linux" })).toEqual([]);
    const problems = assertRuntimeLinkPolicy(inventory, { platform: "win32" });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((problem) => problem.includes("react"))).toBe(true);
  });

  it("flags an absolute or escaping link on unix", () => {
    const source = makeStandaloneFixture();
    symlinkSync("/definitely/outside", path.join(source, "node_modules/.pnpm/node_modules/abs"), "file");
    const problems = assertRuntimeLinkPolicy(collectTreeInventory(source), { platform: "linux" });
    expect(problems.some((problem) => problem.includes("abs"))).toBe(true);
  });

  it("compareInventories reports missing, extra, hash-mismatch and link-target mismatch", () => {
    const source = makeStandaloneFixture();
    const staged = path.join(makeTempDir("veladesk-stage-dst-"), "runtime");
    stageRuntimeTree({ source, destination: staged, platform: "linux" });

    // Identical trees compare clean — twice (idempotent verification).
    const a = collectTreeInventory(staged);
    const b = collectTreeInventory(staged);
    expect(compareInventories(a, b).problems).toEqual([]);

    const mutated = path.join(makeTempDir("veladesk-mut-"), "runtime");
    stageRuntimeTree({ source, destination: mutated, platform: "linux" });
    writeFileSync(path.join(mutated, "apps/web/server.js"), "// tampered\n", "utf8");
    rmSync(path.join(mutated, "apps/web/.next/cache/hidden-marker"));
    writeFileSync(path.join(mutated, "extra-file.txt"), "extra");
    const problems = compareInventories(a, collectTreeInventory(mutated)).problems;
    const joined = problems.join("\n");
    expect(joined).toContain("hash mismatch");
    expect(joined).toContain("hidden-marker");
    expect(joined).toContain("extra-file.txt");
  });

  it("detects a staged link whose target was swapped (link-target mismatch)", () => {
    const treeA = makeStandaloneFixture();
    const treeB = makeStandaloneFixture();
    rmSync(path.join(treeB, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react"));
    symlinkSync("../../semver@6.3.1/node_modules/semver", path.join(treeB, "node_modules/.pnpm/next@16.3.5_fake/node_modules/react"), "dir");
    const problems = compareInventories(collectTreeInventory(treeA), collectTreeInventory(treeB)).problems;
    expect(problems.some((problem) => problem.includes("link target"))).toBe(true);
  });
});
