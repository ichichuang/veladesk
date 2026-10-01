#!/usr/bin/env node
/**
 * VelaDesk release decision (task 025 §15–§19; dispatch mode 027-R1):
 * pure logic deciding whether a push of package.json — or an explicit
 * workflow_dispatch recovery — is a release.
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
 * Dispatch mode (027-R1 §9) is the explicit recovery entry for the CURRENT
 * UNRELEASED source version — no human-supplied version anywhere:
 *
 *   current invalid SemVer          → error
 *   tag v<current> exists           → error
 *   Release v<current> exists       → error
 *   otherwise                       → release v<current>
 *
 * A normal push with an unchanged version still never publishes; only the
 * dispatch event gets the retry semantics.
 *
 * CLI (push):    node scripts/release-version.mjs <previous|-> <current> <tag-exists>
 * CLI (dispatch): node scripts/release-version.mjs dispatch <current> <tag-exists> <release-exists>
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

/**
 * Dispatch mode (027-R1 §9): an explicit recovery of the CURRENT UNRELEASED
 * source version. The version always comes from the root package.json —
 * there is no human-supplied input — and both the tag and the GitHub
 * Release must be absent, so a published version is never re-issued.
 *
 * @param {object} args
 * @param {string} args.currentVersion Current root package.json version.
 * @param {boolean} args.existingTag Whether `v<current>` tag exists.
 * @param {boolean} args.existingRelease Whether GitHub Release `v<current>` exists.
 * @returns {{shouldRelease: boolean, reason: "dispatch-retry", version: string, tag: string}}
 */
export function decideDispatchRelease({ currentVersion, existingTag, existingRelease }) {
  if (!isValidVersion(currentVersion)) {
    throw new Error(`invalid current version: ${JSON.stringify(currentVersion)}`);
  }
  if (existingTag) {
    throw new Error(`tag v${currentVersion} already exists; a published version is never overwritten — bump to a new version instead`);
  }
  if (existingRelease) {
    throw new Error(`release v${currentVersion} already exists; a published version is never re-issued — bump to a new version instead`);
  }
  return {
    shouldRelease: true,
    reason: "dispatch-retry",
    version: currentVersion,
    tag: `v${currentVersion}`,
  };
}

function main(argv) {
  if (argv[0] === "dispatch") {
    const [, currentArg, tagArg, releaseArg] = argv;
    if (currentArg === undefined || tagArg === undefined || releaseArg === undefined) {
      console.error("usage: node scripts/release-version.mjs dispatch <current> <tag-exists:true|false> <release-exists:true|false>");
      process.exitCode = 1;
      return;
    }
    let decision;
    try {
      decision = decideDispatchRelease({
        currentVersion: currentArg,
        existingTag: tagArg === "true",
        existingRelease: releaseArg === "true",
      });
    } catch (error) {
      console.error(`Release decision failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Dispatch recovery of the current unreleased source version`);
    console.log(`Current version: ${decision.version}`);
    console.log(`Expected tag: ${decision.tag}`);
    console.log(`decision: ${JSON.stringify(decision)}`);
    return;
  }
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
