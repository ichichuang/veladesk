import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Tempdir fixtures for the version tooling tests: a miniature VelaDesk
 * workspace with a root manifest, one app, two packages (plus a directory
 * WITHOUT a package.json that must be ignored). Tests never mutate the
 * real repository files.
 */

/** Writes a 2-space JSON file with a trailing newline, like pnpm does. */
export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function makeVersionFixture({ version = "0.1.0" } = {}) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "veladesk-version-"));
  writeJson(path.join(rootDir, "package.json"), {
    name: "veladesk",
    version,
    private: true,
  });
  writeJson(path.join(rootDir, "apps", "web", "package.json"), {
    name: "@veladesk/web",
    version,
    dependencies: { "@veladesk/domain": "workspace:*", next: "^16.3.5" },
  });
  writeJson(path.join(rootDir, "packages", "domain", "package.json"), {
    name: "@veladesk/domain",
    version,
  });
  writeJson(path.join(rootDir, "packages", "assets", "package.json"), {
    name: "@veladesk/assets",
    version,
    devDependencies: { typescript: "^5.9.3" },
  });
  // A workspace-shaped directory WITHOUT package.json must never be listed.
  mkdirSync(path.join(rootDir, "packages", "not-a-package"), { recursive: true });
  // Stray files must not be listed either.
  writeFileSync(path.join(rootDir, "apps", "README.md"), "x\n", "utf8");
  return rootDir;
}

export function cleanupFixture(rootDir) {
  rmSync(rootDir, { recursive: true, force: true });
}
