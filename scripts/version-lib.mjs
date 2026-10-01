/**
 * VelaDesk version library (task 025 §3–§6).
 *
 * ONE version source exists: the ROOT package.json `version`. Everything
 * else — app/package manifests, the Settings page, the Next build, the
 * VERSION file, release archives, git tags and GitHub Releases — derives
 * from it. This module holds the pure functions shared by the version
 * scripts; nothing here mutates repository files.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Plain SemVer only — no prefixes, no prerelease, no build metadata. */
export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Whether a value is a valid plain SemVer string ("1.2.0"; rejects
 * "v1.0.0", "1.0", "1", "01.0.0", "1.0.0-beta", "1.0.0+build", …).
 */
export function isValidVersion(value) {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

/** Parses into numeric components, or null for invalid input. */
export function parseVersion(value) {
  if (!isValidVersion(value)) {
    return null;
  }
  const [major, minor, patch] = value.split(".").map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
}

/**
 * Numeric comparison (never lexical): 1.10.0 > 1.9.9, 1.0.10 > 1.0.9.
 * Returns -1 / 0 / 1; throws on invalid operands.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null) {
    throw new Error(`invalid version: ${JSON.stringify(a)}`);
  }
  if (right === null) {
    throw new Error(`invalid version: ${JSON.stringify(b)}`);
  }
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Reads and validates the root version. Throws a descriptive error when
 * the manifest is missing or its version is not plain SemVer — callers
 * never continue on a broken source of truth.
 */
export function readRootVersion(rootDir) {
  const manifest = path.join(rootDir, "package.json");
  if (!existsSync(manifest)) {
    throw new Error(`root package.json not found at ${manifest}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8"));
  } catch (error) {
    throw new Error(`root package.json is not valid JSON: ${error.message}`);
  }
  const version = parsed?.version;
  if (!isValidVersion(version)) {
    throw new Error(
      `root package.json version must be plain SemVer (e.g. "1.2.0"), found: ${JSON.stringify(version)}`,
    );
  }
  return version;
}

/**
 * Dynamically lists every VelaDesk manifest: the root package.json plus
 * every apps/* and packages/* member that has a package.json. The current
 * repository shape is never hardcoded — new packages are picked up
 * automatically. Order: root first, then apps, then packages (sorted).
 */
export function listVelaDeskManifestPaths(rootDir) {
  const manifests = [path.join(rootDir, "package.json")];
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(rootDir, group);
    if (!existsSync(groupDir)) {
      continue;
    }
    for (const entry of readdirSync(groupDir).sort()) {
      const manifest = path.join(groupDir, entry, "package.json");
      if (existsSync(manifest)) {
        manifests.push(manifest);
      }
    }
  }
  return manifests;
}
