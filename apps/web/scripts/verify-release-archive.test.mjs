import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { verifyReleaseArchive } from "./verify-release-archive.mjs";
import { packageRelease } from "./package-release.mjs";

/**
 * Task 027-R2: the ARCHIVE is the distribution boundary, so the round-trip
 * tests build real tar.gz archives (system tar) inside test-owned temp
 * directories. zip round-trips run wherever the local tar is bsdtar (macOS,
 * the GitHub runners); GNU tar on Linux CI reads neither, and that platform
 * gap is covered for real by the Windows release job itself.
 */

const fixtures = [];
const VERSION = "9.9.9";

const tarVersion = spawnSync("tar", ["--version"], { encoding: "utf8" });
const HAS_BSDTAR = (tarVersion.stdout ?? "").includes("bsdtar");
const TAR = "tar";

function makeTempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

function writeFile(file, content = "x") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

/** A complete staged package via the REAL packager, plus portability canaries. */
function makeStagedPackage(platform = process.platform === "win32" ? "win32" : "linux") {
  const rootDir = makeTempDir("veladesk-arch-");
  writeFile(path.join(rootDir, "package.json"), JSON.stringify({ name: "veladesk", version: VERSION }));
  writeFile(path.join(rootDir, "LICENSE"), "MIT fixture license\n");
  const webDir = path.join(rootDir, "apps", "web");
  writeFile(path.join(webDir, "package.json"), JSON.stringify({ name: "@veladesk/web", version: VERSION }));
  const standalone = path.join(webDir, ".next", "standalone");
  writeFile(path.join(standalone, "apps", "web", "server.js"), "// next standalone server\n");
  // Hidden file inside a dot-directory: archives that drop hidden entries
  // (Compress-Archive) must fail this round-trip.
  writeFile(path.join(standalone, "apps/web/.next/server/hidden-marker.css"), "body{}");
  writeFile(path.join(standalone, "packages", "database", "drizzle", "meta", "_journal.json"), "[]");
  writeFile(path.join(standalone, "packages", "database", "drizzle", "0000_init.sql"), "-- init\n");
  writeFile(path.join(webDir, ".next", "static", "chunk-abc.js"), "// chunk\n");
  writeFile(path.join(webDir, "public", "veladesk-logo.png"), "png");
  // Native binary stand-in.
  writeFile(
    path.join(standalone, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    "\0native\0",
  );
  const outDir = path.join(rootDir, "dist", `VelaDesk-v${VERSION}-test`);
  packageRelease({ version: VERSION, webDir, outDir, platform });
  return { rootDir, stagedDir: outDir, platform };
}

function createTarball(stagedDir, archiveFile, format) {
  const parent = path.dirname(stagedDir);
  const base = path.basename(stagedDir);
  const args =
    format === "zip"
      ? ["-a", "-cf", archiveFile, "-C", parent, base]
      : ["-czf", archiveFile, "-C", parent, base];
  const result = spawnSync(TAR, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`fixture tar creation failed: ${result.stderr}`);
  }
}

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

describe("verifyReleaseArchive — tar.gz round-trip", () => {
  it("verifies a faithful archive, extracting into a path with spaces and non-ASCII characters", () => {
    const { stagedDir, platform } = makeStagedPackage();
    const archiveFile = path.join(path.dirname(stagedDir), "pkg.tar.gz");
    createTarball(stagedDir, archiveFile, "tar.gz");
    const extractRoot = path.join(makeTempDir("veladesk-x "), "VelaDesk 归档校验 dir");

    const result = verifyReleaseArchive({ archive: archiveFile, stagedDir, extractRoot, platform });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.fileCount).toBeGreaterThan(5);
    // The extracted package really is at the spaced/non-ASCII location.
    expect(result.extractedPackageDir.startsWith(extractRoot)).toBe(true);
    expect(existsSync(path.join(result.extractedPackageDir, "runtime", "apps", "web", "server.js"))).toBe(true);
  });

  it("fails when the archive drops a hidden dot-file (the Compress-Archive defect class)", () => {
    const { stagedDir, platform } = makeStagedPackage();
    // Re-create the archive from a tree that LACKS the hidden file.
    const holeDir = path.join(makeTempDir("veladesk-hole-"), path.basename(stagedDir));
    spawnSync("cp", ["-R", stagedDir, holeDir]);
    rmSync(path.join(holeDir, "runtime", "apps", "web", ".next", "server", "hidden-marker.css"));
    const archiveFile = path.join(makeTempDir("veladesk-a-"), "pkg.tar.gz");
    createTarball(holeDir, archiveFile, "tar.gz");
    const extractRoot = path.join(makeTempDir("veladesk-x "), "extract");

    const result = verifyReleaseArchive({ archive: archiveFile, stagedDir, extractRoot, platform });
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes("hidden-marker.css"))).toBe(true);
  });

  it("fails when a staged file was tampered after archiving (hash mismatch)", () => {
    const { stagedDir, platform } = makeStagedPackage();
    const archiveFile = path.join(path.dirname(stagedDir), "pkg.tar.gz");
    createTarball(stagedDir, archiveFile, "tar.gz");
    writeFileSync(path.join(stagedDir, "runtime", "apps", "web", "server.js"), "// tampered\n", "utf8");
    const extractRoot = path.join(makeTempDir("veladesk-x "), "extract");

    const result = verifyReleaseArchive({ archive: archiveFile, stagedDir, extractRoot, platform });
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes("hash mismatch"))).toBe(true);
  });

  it("rejects an archive whose extracted tree carries an escaping link (unix)", () => {
    const rawRoot = makeTempDir("veladesk-raw-");
    const packageDir = path.join(rawRoot, "VelaDesk-v9.9.9-evil");
    writeFile(path.join(packageDir, "runtime", "apps", "web", "server.js"), "// server\n");
    writeFile(path.join(packageDir, "runtime", "packages", "database", "drizzle", "0000_init.sql"), "-- init\n");
    writeFile(path.join(packageDir, "runtime", "node_modules", "better-sqlite3", "b.node"), "\0n\0");
    writeFile(path.join(packageDir, "LICENSE"), "MIT\n");
    const launcher = path.join(packageDir, "start-veladesk.sh");
    writeFile(launcher, "#!/bin/sh\n");
    chmodSync(launcher, 0o755);
    writeFile(path.join(packageDir, "runtime", "apps", "web", ".next", "marker.txt"), "next\n");
    symlinkSync("/runner/workspace/checkout", path.join(packageDir, "runtime", "node_modules", "checkout-link"), "dir");

    const archiveFile = path.join(makeTempDir("veladesk-a-"), "evil.tar.gz");
    createTarball(packageDir, archiveFile, "tar.gz");
    const extractRoot = path.join(makeTempDir("veladesk-x "), "extract");

    const result = verifyReleaseArchive({ archive: archiveFile, stagedDir: packageDir, extractRoot, platform: "linux" });
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes("checkout-link"))).toBe(true);
  });

  it("rejects a win32 archive that contains any link at all", () => {
    const rawRoot = makeTempDir("veladesk-raw-");
    const packageDir = path.join(rawRoot, "VelaDesk-v9.9.9-evilwin");
    writeFile(path.join(packageDir, "runtime", "apps", "web", "server.js"), "// server\n");
    writeFile(path.join(packageDir, "runtime", "packages", "database", "drizzle", "0000_init.sql"), "-- init\n");
    writeFile(path.join(packageDir, "runtime", "node_modules", "better-sqlite3", "b.node"), "\0n\0");
    writeFile(path.join(packageDir, "LICENSE"), "MIT\n");
    writeFile(path.join(packageDir, "start-veladesk.cmd"), "@echo off\r\n");
    writeFile(path.join(packageDir, "runtime", "apps", "web", ".next", "marker.txt"), "next\n");
    writeFile(path.join(packageDir, "runtime", "node_modules", "react", "index.js"), "react\n");
    symlinkSync("../react", path.join(packageDir, "runtime", "node_modules", "react-alias"), "dir");

    const archiveFile = path.join(makeTempDir("veladesk-a-"), "evilwin.tar.gz");
    createTarball(packageDir, archiveFile, "tar.gz");
    const extractRoot = path.join(makeTempDir("veladesk-x "), "extract");

    const result = verifyReleaseArchive({ archive: archiveFile, stagedDir: packageDir, extractRoot, platform: "win32" });
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes("react-alias"))).toBe(true);
  });
});

describe("verifyReleaseArchive — zip round-trip (bsdtar)", () => {
  it.skipIf(!HAS_BSDTAR)("verifies a bsdtar-built zip like the Windows release job creates", () => {
    const { stagedDir, platform } = makeStagedPackage();
    const archiveFile = path.join(path.dirname(stagedDir), "pkg.zip");
    createTarball(stagedDir, archiveFile, "zip");
    const extractRoot = path.join(makeTempDir("veladesk-x "), "VelaDesk 归档校验 zip");

    const result = verifyReleaseArchive({ archive: archiveFile, stagedDir, extractRoot, platform });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(archiveFile.endsWith(".zip")).toBe(true);
  });
});
