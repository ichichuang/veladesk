#!/usr/bin/env node
/**
 * VelaDesk static release verifier (task 025 §27, §36).
 *
 * NEVER starts a server. Checks the assembled release package for every
 * file a self-hosted boot needs and reports EVERY missing piece at once
 * (exit non-zero with the concrete list):
 *
 *   VERSION == the ROOT package.json version (single source of truth)
 *   LICENSE, START.md
 *   runtime/apps/web/server.js (probed, layout-verified)
 *   runtime/apps/web/.next/static — present AND non-empty
 *   runtime/apps/web/public
 *   runtime/packages/database/drizzle/meta/_journal.json + >=1 *.sql
 *   the platform launcher (start-veladesk.cmd on win32, .sh otherwise)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readRootVersion } from "../../../scripts/version-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");

/**
 * @param {string} packageDir The assembled release directory.
 * @param {object} [options]
 * @param {string} [options.repoRoot] Where the root package.json lives.
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function verifyReleasePackage(packageDir, options = {}) {
  const problems = [];
  const rootDir = options.repoRoot ?? repoRoot;

  const expect = (condition, message) => {
    if (!condition) {
      problems.push(message);
    }
  };

  if (!existsSync(packageDir)) {
    return { ok: false, problems: [`package directory missing: ${packageDir}`] };
  }

  // VERSION must equal the single source of truth — never its own version.
  const versionFile = path.join(packageDir, "VERSION");
  if (!existsSync(versionFile)) {
    problems.push("VERSION missing");
  } else {
    const packaged = readFileSync(versionFile, "utf8").trim();
    const expected = readRootVersion(rootDir);
    if (packaged !== expected) {
      problems.push(`VERSION is "${packaged}" but the root package.json says "${expected}"`);
    }
  }

  expect(existsSync(path.join(packageDir, "LICENSE")), "LICENSE missing");
  expect(existsSync(path.join(packageDir, "START.md")), "START.md missing");

  // Runtime contract: the packager pins runtime/apps/web/server.js (it
  // fails the build if the standalone layout ever differs), and the
  // launcher cds into exactly that directory.
  const runtimeDir = path.join(packageDir, "runtime");
  const serverJs = path.join(runtimeDir, "apps", "web", "server.js");
  expect(existsSync(serverJs), "server.js missing at runtime/apps/web/server.js (expected the monorepo tracing layout)");

  const staticDir = path.join(runtimeDir, "apps", "web", ".next", "static");
  if (!existsSync(staticDir)) {
    problems.push(".next/static missing from the runtime (Next standalone never copies it — the packager must)");
  } else {
    expect(readdirSync(staticDir).length > 0, ".next/static is EMPTY");
  }

  expect(
    existsSync(path.join(runtimeDir, "apps", "web", "public")),
    "public/ missing from the runtime (the packager must copy it)",
  );

  const drizzleDir = path.join(runtimeDir, "packages", "database", "drizzle");
  const journal = path.join(drizzleDir, "meta", "_journal.json");
  expect(existsSync(journal), "migration journal missing (runtime/packages/database/drizzle/meta/_journal.json)");
  if (existsSync(drizzleDir)) {
    const sqlCount = readdirSync(drizzleDir).filter((entry) => entry.endsWith(".sql")).length;
    expect(sqlCount > 0, "no *.sql migration files in runtime/packages/database/drizzle");
  }

  const launcher = process.platform === "win32" ? "start-veladesk.cmd" : "start-veladesk.sh";
  expect(existsSync(path.join(packageDir, launcher)), `${launcher} missing`);

  return { ok: problems.length === 0, problems };
}

function main() {
  const packageDir = process.argv[2];
  if (packageDir === undefined) {
    console.error("usage: node verify-release-package.mjs <release-package-dir>");
    process.exitCode = 1;
    return;
  }
  try {
    const { ok, problems } = verifyReleasePackage(path.resolve(packageDir));
    if (ok) {
      console.log("Release package verified.");
      return;
    }
    console.error("Release package incomplete:");
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
