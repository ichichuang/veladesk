#!/usr/bin/env node
/**
 * Runtime link inspector (task 027-R2).
 *
 * Two jobs, one bounded walker:
 *
 *   --describe        Evidence mode: report every link found under a tree —
 *                     logical path, raw target, relative/absolute form,
 *                     whether it resolves, and whether it stays inside the
 *                     tree — then exit 0. This is how the pnpm isolated
 *                     layout's Windows junctions get RECORDED on a runner
 *                     instead of guessed from a stack trace.
 *   --expect none     Gate: fail if the tree contains ANY link (the Windows
 *                     package contract — end-user extraction cannot create
 *                     junctions, so the package must be link-free).
 *   --expect internal-only
 *                     Gate: fail unless every link is relative AND resolves
 *                     inside the tree (the unix package contract).
 *
 * Output is bounded (--limit, default 50 links) and never dumps anything but
 * paths and targets.
 */

import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {object} input
 * @param {string} input.root Tree to inspect.
 * @param {number} [input.limit] Maximum links reported (bounded output).
 * @returns {{ links: Array<{ path: string, target: string, targetKind: "relative" | "absolute", resolves: boolean, resolvedPath: string | null, insideRoot: boolean }>, total: number }}
 */
export function inspectTreeLinks({ root, limit = 50 }) {
  const rootPath = path.resolve(root);
  if (!existsSync(rootPath)) {
    throw new Error(`inspect-runtime-links: tree missing: ${rootPath}`);
  }
  const links = [];
  let total = 0;
  // Compare realpaths on both sides: on macOS e.g. /var is a symlink to
  // /private/var, so an un-resolved root prefix would misclassify every link.
  const rootReal = realpathSync(rootPath);
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      let stats;
      try {
        stats = lstatSync(full);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink()) {
        total += 1;
        if (links.length >= limit) {
          continue;
        }
        const target = readlinkSync(full);
        const logical = path.resolve(path.dirname(full), target);
        let resolvedPath = null;
        let resolves = false;
        try {
          resolvedPath = realpathSync(full);
          resolves = true;
        } catch {
          resolves = false;
        }
        const insideRoot = resolves
          ? resolvedPath === rootReal || resolvedPath.startsWith(rootReal + path.sep)
          : logical === rootReal || logical.startsWith(rootReal + path.sep);
        links.push({
          path: path.relative(rootPath, full),
          target,
          targetKind: path.isAbsolute(target) ? "absolute" : "relative",
          resolves,
          resolvedPath,
          insideRoot,
        });
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(rootPath);
  return { links, total };
}

/** Classifies one inspected link against the two package contracts. */
export function linkViolations({ links, expect }) {
  if (expect === "none") {
    return links.map((link) => `link-free contract violated: ${link.path} -> ${link.target}`);
  }
  return links
    .filter((link) => link.targetKind === "absolute" || !link.insideRoot || !link.resolves)
    .map(
      (link) =>
        `internal-only contract violated: ${link.path} -> ${link.target} ` +
        `(kind=${link.targetKind}, resolves=${link.resolves}, insideRoot=${link.insideRoot})`,
    );
}

function main(argv) {
  const root = argv[0];
  const describe = argv.includes("--describe");
  const expectIndex = argv.indexOf("--expect");
  const expect = expectIndex !== -1 ? argv[expectIndex + 1] : undefined;
  const limitIndex = argv.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(argv[limitIndex + 1]) : 50;

  if (root === undefined || (argv[0] ?? "").startsWith("--")) {
    console.error("usage: node inspect-runtime-links.mjs <tree> [--describe | --expect none|internal-only] [--limit N]");
    process.exitCode = 1;
    return;
  }
  if (expect !== undefined && expect !== "none" && expect !== "internal-only") {
    console.error(`--expect must be none or internal-only (got ${expect})`);
    process.exitCode = 1;
    return;
  }
  if (describe && expect !== undefined) {
    console.error("--describe and --expect are mutually exclusive");
    process.exitCode = 1;
    return;
  }

  const { links, total } = inspectTreeLinks({ root, limit });
  console.log(`links under ${root}: ${total}${total > links.length ? ` (reporting first ${links.length})` : ""}`);
  for (const link of links) {
    console.log(
      `  [${link.targetKind}${link.resolves ? "" : ", dangling"}${link.insideRoot ? "" : ", OUTSIDE"}] ` +
        `${link.path} -> ${link.target}` +
        (link.resolves && !link.insideRoot ? ` (resolves to ${link.resolvedPath})` : ""),
    );
  }
  if (describe) {
    return;
  }
  const violations = expect === undefined ? [] : linkViolations({ links, expect });
  // The gate must judge ALL links, not just the reported slice.
  if (expect === "none" && total > 0) {
    violations.push(`link-free contract violated: ${total} link(s) total under ${root}`);
  }
  if (violations.length > 0) {
    console.error(`runtime link gate FAILED (--expect ${expect}):`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exitCode = 1;
    return;
  }
  if (expect !== undefined) {
    console.log(`runtime link gate passed (--expect ${expect})`);
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2));
}
