#!/usr/bin/env node
/**
 * VelaDesk version checker (task 025 §8): `pnpm version:check`.
 *
 * Verifies the root version is plain SemVer and that EVERY VelaDesk
 * manifest carries exactly the same version. Read-only by contract — it
 * never repairs drift (that is `pnpm version:set`'s job). Exit code 0 on
 * agreement, non-zero with the exact drifting manifests otherwise.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isValidVersion, listVelaDeskManifestPaths } from "./version-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Checks all manifests under `rootDir` against the root version.
 * `mismatches` lists every manifest whose version differs (or whose
 * version is invalid) with the value it carries.
 */
export function checkAllVersions(rootDir) {
  const rootManifest = path.join(rootDir, "package.json");
  let rootVersion;
  try {
    rootVersion = JSON.parse(readFileSync(rootManifest, "utf8")).version;
  } catch {
    rootVersion = undefined;
  }
  if (!isValidVersion(rootVersion)) {
    return {
      ok: false,
      version: rootVersion,
      checked: 1,
      mismatches: [{ path: rootManifest, version: rootVersion ?? null }],
      invalidRoot: true,
    };
  }

  const mismatches = [];
  let checked = 0;
  for (const manifest of listVelaDeskManifestPaths(rootDir)) {
    checked += 1;
    let version;
    try {
      version = JSON.parse(readFileSync(manifest, "utf8")).version;
    } catch {
      version = undefined;
    }
    if (version !== rootVersion) {
      mismatches.push({ path: manifest, version: version ?? null });
    }
  }
  return { ok: mismatches.length === 0, version: rootVersion, checked, mismatches, invalidRoot: false };
}

function main() {
  let result;
  try {
    result = checkAllVersions(repoRoot);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (result.ok) {
    console.log(`VelaDesk version: ${result.version}`);
    console.log(`${result.checked} manifests checked`);
    console.log("All versions match.");
    return;
  }
  console.error("Version mismatch:");
  console.error("");
  console.error("root:");
  console.error(String(result.version));
  console.error("");
  for (const mismatch of result.mismatches) {
    console.error(`${path.relative(repoRoot, mismatch.path)}:`);
    console.error(String(mismatch.version));
    console.error("");
  }
  process.exitCode = 1;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
