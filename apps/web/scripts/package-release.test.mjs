import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  archiveExtension,
  packageRelease,
  platformLabel,
  releaseArchiveName,
  releaseDirectoryBase,
} from "./package-release.mjs";
import { verifyReleasePackage } from "./verify-release-package.mjs";

/**
 * Tempdir fixtures (task 025 §37): a miniature repo + build tree — root
 * manifest & LICENSE, apps/web with a fake .next/standalone (server.js,
 * traced migrations), .next/static and public. The real build is never
 * needed and the real repository is never touched.
 */

const VERSION = "9.9.9";
const fixtures = [];

function makeBuildFixture() {
  const rootDir = mkdtempSync(path.join(tmpdir(), "veladesk-pkg-"));
  fixtures.push(rootDir);
  writeJson(path.join(rootDir, "package.json"), { name: "veladesk", version: VERSION });
  writeFileSync(path.join(rootDir, "LICENSE"), "MIT fixture license\n", "utf8");

  const webDir = path.join(rootDir, "apps", "web");
  writeJson(path.join(webDir, "package.json"), { name: "@veladesk/web", version: VERSION });
  const standalone = path.join(webDir, ".next", "standalone");
  writeFile(path.join(standalone, "apps", "web", "server.js"), "// next standalone server\n");
  writeFile(path.join(standalone, "apps", "web", ".next", "pages", "placeholder.txt"), "x");
  writeFile(path.join(standalone, "packages", "database", "drizzle", "meta", "_journal.json"), "[]");
  writeFile(path.join(standalone, "packages", "database", "drizzle", "0000_init.sql"), "-- init\n");
  writeFile(path.join(webDir, ".next", "static", "chunk-abc.js"), "// chunk\n");
  writeFile(path.join(webDir, "public", "favicon.ico"), "ico");
  return { rootDir, webDir };
}

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

describe("platform naming helpers (task 025 §25, §38)", () => {
  it("maps real process platforms to user-facing labels", () => {
    expect(platformLabel("win32")).toBe("windows");
    expect(platformLabel("darwin")).toBe("macos");
    expect(platformLabel("linux")).toBe("linux");
  });

  it("derives archive names from the version, once", () => {
    expect(releaseDirectoryBase("1.2.0", "darwin", "arm64")).toBe("VelaDesk-v1.2.0-macos-arm64");
    expect(releaseArchiveName("1.2.0", "win32", "x64")).toBe("VelaDesk-v1.2.0-windows-x64.zip");
    expect(releaseArchiveName("1.2.0", "linux", "x64")).toBe("VelaDesk-v1.2.0-linux-x64.tar.gz");
    expect(archiveExtension("win32")).toBe("zip");
    expect(archiveExtension("darwin")).toBe("tar.gz");
  });

  it("uses the ACTUAL process platform and arch, never a guess", () => {
    const base = releaseDirectoryBase("1.2.0");
    expect(base).toBe(`VelaDesk-v1.2.0-${platformLabel(process.platform)}-${process.arch}`);
  });
});

describe("packageRelease (task 025 §24–§33)", () => {
  it("assembles the complete staging tree with derived metadata", () => {
    const { rootDir, webDir } = makeBuildFixture();
    const outDir = path.join(rootDir, "dist", releaseDirectoryBase(VERSION));
    const manifest = packageRelease({ version: VERSION, webDir, outDir });

    expect(manifest.version).toBe(VERSION);
    expect(manifest.archiveName).toBe(releaseArchiveName(VERSION));
    expect(readFileSync(path.join(outDir, "VERSION"), "utf8").trim()).toBe(VERSION);
    expect(readFileSync(path.join(outDir, "LICENSE"), "utf8")).toContain("MIT fixture license");
    expect(readFileSync(path.join(outDir, "START.md"), "utf8")).toContain(`VelaDesk ${VERSION}`);
    expect(readFileSync(path.join(outDir, "START.md"), "utf8")).toContain("Node.js 24 LTS");
    expect(existsSync(path.join(outDir, "server.js"))).toBe(false); // never at the package root

    // static + public land BESIDE server.js; migrations at the fixed path.
    const runtimeWeb = path.join(outDir, "runtime", "apps", "web");
    expect(existsSync(path.join(runtimeWeb, "server.js"))).toBe(true);
    expect(existsSync(path.join(runtimeWeb, ".next", "static", "chunk-abc.js"))).toBe(true);
    expect(existsSync(path.join(runtimeWeb, "public", "favicon.ico"))).toBe(true);
    expect(existsSync(path.join(outDir, "runtime", "packages", "database", "drizzle", "meta", "_journal.json"))).toBe(
      true,
    );
    expect(existsSync(path.join(outDir, "runtime", "packages", "database", "drizzle", "0000_init.sql"))).toBe(true);

    // The current platform's launcher is generated.
    const launcher = process.platform === "win32" ? "start-veladesk.cmd" : "start-veladesk.sh";
    expect(existsSync(path.join(outDir, launcher))).toBe(true);
  });

  it("the launcher pins loopback defaults and the release migrations path", () => {
    const { rootDir, webDir } = makeBuildFixture();
    const outDir = path.join(rootDir, "dist", "pkg");
    packageRelease({ version: VERSION, webDir, outDir });
    if (process.platform === "win32") {
      const cmd = readFileSync(path.join(outDir, "start-veladesk.cmd"), "utf8");
      expect(cmd).toContain("127.0.0.1");
      expect(cmd).toContain("VELADESK_HOST");
      expect(cmd).toContain("VELADESK_PORT");
      expect(cmd).toContain("LOCALAPPDATA");
      expect(cmd).toContain("runtime\\packages\\database\\drizzle");
      expect(cmd).toContain("node server.js");
    } else {
      const sh = readFileSync(path.join(outDir, "start-veladesk.sh"), "utf8");
      expect(sh).toContain("127.0.0.1");
      expect(sh).toContain("VELADESK_HOST");
      expect(sh).toContain("VELADESK_PORT");
      expect(sh).toContain("runtime/packages/database/drizzle");
      expect(sh).toContain("exec node server.js");
      expect(sh).toContain("Application Support/VelaDesk");
      expect(sh).toContain(".local/share");
    }
  });

  it("fails loudly when the standalone tree is missing server.js", () => {
    const { rootDir, webDir } = makeBuildFixture();
    rmSync(path.join(webDir, ".next", "standalone", "apps", "web", "server.js"));
    expect(() => packageRelease({ version: VERSION, webDir, outDir: path.join(rootDir, "dist", "a") })).toThrow(
      /server\.js/,
    );
  });

  it("fails loudly when .next/static is missing", () => {
    const { rootDir, webDir } = makeBuildFixture();
    rmSync(path.join(webDir, ".next", "static"), { recursive: true, force: true });
    expect(() => packageRelease({ version: VERSION, webDir, outDir: path.join(rootDir, "dist", "a") })).toThrow(
      /static/,
    );
  });

  it("fails loudly when migrations were not traced", () => {
    const { rootDir, webDir } = makeBuildFixture();
    rmSync(path.join(webDir, ".next", "standalone", "packages"), { recursive: true, force: true });
    expect(() => packageRelease({ version: VERSION, webDir, outDir: path.join(rootDir, "dist", "a") })).toThrow(
      /journal/,
    );
  });
});

describe("verifyReleasePackage (task 025 §36–§37)", () => {
  function packaged() {
    const { rootDir, webDir } = makeBuildFixture();
    const outDir = path.join(rootDir, "dist", releaseDirectoryBase(VERSION));
    packageRelease({ version: VERSION, webDir, outDir });
    return { rootDir, outDir };
  }

  it("passes on a complete package", () => {
    const { rootDir, outDir } = packaged();
    const result = verifyReleasePackage(outDir, { repoRoot: rootDir });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags a VERSION that drifted from the root manifest", () => {
    const { rootDir, outDir } = packaged();
    writeFileSync(path.join(outDir, "VERSION"), "0.0.1\n", "utf8");
    const result = verifyReleasePackage(outDir, { repoRoot: rootDir });
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => problem.includes("root package.json"))).toBe(true);
  });

  it("reports missing SQL, static, public, launcher and VERSION concretely", () => {
    const { rootDir, outDir } = packaged();
    rmSync(path.join(outDir, "runtime", "packages", "database", "drizzle", "0000_init.sql"));
    rmSync(path.join(outDir, "runtime", "apps", "web", ".next", "static"), { recursive: true, force: true });
    rmSync(path.join(outDir, "runtime", "apps", "web", "public"), { recursive: true, force: true });
    rmSync(path.join(outDir, "VERSION"));
    const launcher = process.platform === "win32" ? "start-veladesk.cmd" : "start-veladesk.sh";
    rmSync(path.join(outDir, launcher));

    const result = verifyReleasePackage(outDir, { repoRoot: rootDir });
    expect(result.ok).toBe(false);
    const joined = result.problems.join("\n");
    expect(joined).toContain("VERSION missing");
    expect(joined).toContain(".sql");
    expect(joined).toContain("static");
    expect(joined).toContain("public");
    expect(joined).toContain(launcher);
  });

  it("flags an EMPTY static directory", () => {
    const { rootDir, outDir } = packaged();
    const staticDir = path.join(outDir, "runtime", "apps", "web", ".next", "static");
    rmSync(staticDir, { recursive: true, force: true });
    mkdirSync(staticDir, { recursive: true });
    const result = verifyReleasePackage(outDir, { repoRoot: rootDir });
    expect(result.problems.some((problem) => problem.includes("EMPTY"))).toBe(true);
  });

  it("flags a missing migration journal", () => {
    const { rootDir, outDir } = packaged();
    rmSync(path.join(outDir, "runtime", "packages", "database", "drizzle", "meta"), { recursive: true, force: true });
    const result = verifyReleasePackage(outDir, { repoRoot: rootDir });
    expect(result.problems.some((problem) => problem.includes("_journal.json"))).toBe(true);
  });
});
