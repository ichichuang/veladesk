#!/usr/bin/env node
/**
 * VelaDesk release decision (task 025 §15–§19): pure logic deciding whether
 * a push of package.json is a release.
 *
 * The release workflow triggers on any main push touching package.json —
 * including dependency-only edits — so the decision compares the PREVIOUS
 * commit's root version with the CURRENT one. Rules:
 *
 *   previous === current            → no release (normal exit)
 *   current invalid SemVer          → error
 *   previous invalid SemVer         → error
 *   current < previous (regression) → error — versions only move forward
 *   target tag already exists       → error — a published version is never
 *                                        overwritten, re-released or moved
 *   current > previous (or first)   → release v<current>
 *
 * CLI: node scripts/release-version.mjs <previous|-> <current> <tag-exists>
 * Prints human logs plus one machine-readable `decision:` JSON line;
 * exit 0 for both release and no-release outcomes, exit 1 on rule errors
 * (the workflow treats that as a hard failure: no tag, no release).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareVersions, isValidVersion } from "./version-lib.mjs";

/**
 * @param {object} args
 * @param {string | null} args.previousVersion Previous root version, or
 *   null when the push has no known predecessor (first release).
 * @param {string} args.currentVersion Current root version.
 * @param {boolean} args.existingTag Whether `v<current>` already exists.
 * @returns {{shouldRelease: boolean, reason: "unchanged" | "release", version: string, tag: string}}
 */
export function decideRelease({ previousVersion, currentVersion, existingTag }) {
  if (!isValidVersion(currentVersion)) {
    throw new Error(`invalid current version: ${JSON.stringify(currentVersion)}`);
  }
  if (previousVersion !== null && !isValidVersion(previousVersion)) {
    throw new Error(`invalid previous version: ${JSON.stringify(previousVersion)}`);
  }
  if (existingTag) {
    throw new Error(`tag v${currentVersion} already exists; a published version is never overwritten — bump to a new version instead`);
  }
  if (previousVersion === null || compareVersions(currentVersion, previousVersion) > 0) {
    return {
      shouldRelease: true,
      reason: "release",
      version: currentVersion,
      tag: `v${currentVersion}`,
    };
  }
  if (compareVersions(currentVersion, previousVersion) === 0) {
    return {
      shouldRelease: false,
      reason: "unchanged",
      version: currentVersion,
      tag: `v${currentVersion}`,
    };
  }
  throw new Error(
    `version moved backwards: ${previousVersion} -> ${currentVersion}; VelaDesk versions only move forward`,
  );
}

function main(argv) {
  const [previousArg, currentArg, tagArg] = argv;
  if (currentArg === undefined || tagArg === undefined) {
    console.error("usage: node scripts/release-version.mjs <previous|-> <current> <tag-exists:true|false>");
    process.exitCode = 1;
    return;
  }
  const previousVersion = previousArg === "-" ? null : previousArg;
  const existingTag = tagArg === "true";
  let decision;
  try {
    decision = decideRelease({ previousVersion, currentVersion: currentArg, existingTag });
  } catch (error) {
    console.error(`Release decision failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Previous version: ${previousVersion ?? "(none)"}`);
  console.log(`Current version: ${decision.version}`);
  if (decision.shouldRelease) {
    console.log(`Expected tag: ${decision.tag}`);
  }
  console.log(`decision: ${JSON.stringify(decision)}`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2));
}
