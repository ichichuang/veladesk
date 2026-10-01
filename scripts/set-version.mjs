#!/usr/bin/env node
/**
 * VelaDesk version setter (task 025 §7): `pnpm version:set 1.1.0`.
 *
 * Validates the new version, then writes it into the root manifest and
 * every apps/* + packages/* manifest — preserving the 2-space JSON layout
 * and each file's trailing-newline state, changing ONLY the version field
 * (workspace:* and every other entry are untouched). Never commits, tags
 * or pushes: those remain deliberate human (or CI) actions.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isValidVersion, listVelaDeskManifestPaths } from "./version-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Applies `nextVersion` to every VelaDesk manifest under `rootDir`.
 * Returns the updated manifest paths; throws (writing nothing) when the
 * version is not plain SemVer.
 */
export function applyVersionToRoot(rootDir, nextVersion) {
  if (!isValidVersion(nextVersion)) {
    throw new Error(
      `"${nextVersion}" is not a plain SemVer version (expected e.g. 1.2.0; no v-prefix, no prerelease, no build metadata)`,
    );
  }
  const updated = [];
  for (const manifest of listVelaDeskManifestPaths(rootDir)) {
    const before = readFileSync(manifest, "utf8");
    const parsed = JSON.parse(before);
    parsed.version = nextVersion;
    // Keep the exact serialization contract: 2-space indent and the same
    // trailing-newline state the file already had.
    const hadTrailingNewline = before.endsWith("\n");
    const after = JSON.stringify(parsed, null, 2) + (hadTrailingNewline ? "\n" : "");
    writeFileSync(manifest, after, "utf8");
    updated.push(manifest);
  }
  return { version: nextVersion, updated };
}

function main() {
  const nextVersion = process.argv[2];
  if (nextVersion === undefined) {
    console.error("usage: pnpm version:set <X.Y.Z>");
    process.exitCode = 1;
    return;
  }
  try {
    const { version, updated } = applyVersionToRoot(repoRoot, nextVersion);
    console.log(`VelaDesk version: ${version}`);
    console.log("");
    console.log("Updated:");
    for (const manifest of updated) {
      console.log(path.relative(repoRoot, manifest));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
