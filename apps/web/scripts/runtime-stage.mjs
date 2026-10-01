/**
 * Portable runtime staging (task 027-R2).
 *
 * The first 1.0.0 Windows release run (36849597035) died with
 * `EPERM … realpathSync` on
 * `standalone/node_modules/.pnpm/next@16.3.5_…/node_modules/react`: Next's
 * copyTracedFiles (next/dist/build/utils.js) recreates every traced link
 * with the RAW readlink target string, and pnpm's isolated layout on
 * Windows uses junctions whose targets are ABSOLUTE paths into the build
 * checkout. Such a bundle can never resolve on a user machine — and on the
 * runner itself the recreated reparse entry failed stat with EPERM.
 *
 * This module stages a runtime tree so the result is self-contained:
 *
 *   - regular files/directories are copied byte-identically (dot-files and
 *     dot-directories included — they are payload, not noise);
 *   - a link whose target resolves INSIDE the tree is the only tolerated
 *     shape: preserved as the same relative link on unix, materialized into
 *     real files/directories on win32 (end-user extraction cannot create
 *     junctions, so the Windows package must be link-free);
 *   - everything else — dangling, unreadable, absolute-external, escaping,
 *     cyclic, or a mapping conflict — FAILS with the exact offending path.
 *     No guessed package mappings, no first-match-by-name reconstruction.
 *
 * The release build installs dependencies with pnpm's supported hoisted
 * nodeLinker (flat, symlink-free), so a healthy build reaches this copier
 * with zero links at all; the policy here is the safety net that keeps a
 * layout regression loud instead of shipped.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

/** Expansion bound: total entries (files + dirs + links) a stage may copy. */
export const DEFAULT_STAGE_ENTRY_LIMIT = 500_000;

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Maps an out-of-tree link target back into the tree: the target must live
 * under `allowedExternalRoot` (the build checkout), and the SAME relative
 * path must exist as a real (non-link) entry inside the tree. Returns the
 * in-tree twin's source path, or null when no verified mapping exists.
 */
function resolveExternalTwin({ logicalTarget, allowedExternalRoot, sourceRoot }) {
  if (allowedExternalRoot === undefined) {
    return null;
  }
  const externalRoot = path.resolve(allowedExternalRoot);
  if (!isInside(externalRoot, path.resolve(logicalTarget))) {
    return null;
  }
  const checkoutRelative = path.relative(externalRoot, path.resolve(logicalTarget));
  const twin = path.join(sourceRoot, checkoutRelative);
  let twinStats;
  try {
    twinStats = lstatSync(twin);
  } catch {
    return null;
  }
  if (twinStats.isSymbolicLink() || !twinStats.isDirectory()) {
    return null;
  }
  return twin;
}

function fail(message) {
  throw new Error(message);
}

/**
 * Copies `source` into `destination` under the platform's link policy.
 *
 * @param {object} input
 * @param {string} input.source The tree to stage (standalone output).
 * @param {string} input.destination Where the staged copy is created
 *   (removed first if it exists).
 * @param {string} [input.platform] Policy selector — win32 materializes
 *   in-tree links, everything else preserves them.
 * @param {string} [input.allowedExternalRoot] The build checkout root. An
 *   out-of-tree link is RECONSTRUCTED only when its target maps, by the
 *   checkout-relative path, onto a real entry that also exists inside the
 *   tree (the verified trace-relative mapping) — e.g. turbopack's Windows
 *   native-external marker junction pointing at checkout node_modules while
 *   the same package is traced into the bundle. Anything else still fails.
 * @param {number} [input.maxEntries] Expansion bound.
 * @returns {{ files: number, directories: number, links: Array<{ path: string, target: string, action: "preserved" | "materialized" | "reconstructed" }> }}
 */
export function stageRuntimeTree({
  source,
  destination,
  platform = process.platform,
  allowedExternalRoot,
  maxEntries = DEFAULT_STAGE_ENTRY_LIMIT,
}) {
  const sourceRoot = path.resolve(source);
  const destRoot = path.resolve(destination);
  if (!existsSync(sourceRoot)) {
    fail(`stageRuntimeTree: source missing: ${sourceRoot}`);
  }
  if (isInside(sourceRoot, destRoot) || isInside(destRoot, sourceRoot)) {
    fail(`stageRuntimeTree: refusing to copy a directory into itself (${sourceRoot} vs ${destRoot})`);
  }
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  let files = 0;
  let directories = 0;
  const links = [];
  // Logical target dirs currently being materialized — a link pointing back
  // into one of them is a cycle that would recurse forever.
  const materializing = [];

  const countEntry = (entryPath) => {
    if (files + directories + links.length + 1 > maxEntries) {
      fail(
        `stageRuntimeTree: excessive expansion beyond ${maxEntries} entries (offending path: ${entryPath}); ` +
          "the runtime graph is larger than the portable-bundle budget",
      );
    }
  };

  const stageDirectory = (srcDir, dstDir) => {
    for (const entry of readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const src = path.join(srcDir, entry.name);
      const dst = path.join(dstDir, entry.name);
      const relativeEntry = path.relative(sourceRoot, src);

      let stats;
      try {
        stats = lstatSync(src);
      } catch (error) {
        fail(`stageRuntimeTree: cannot lstat ${src}: ${error.code ?? error.message}`);
      }

      if (stats.isSymbolicLink()) {
        countEntry(src);
        stageLink(src, dst, relativeEntry);
        continue;
      }
      if (stats.isDirectory()) {
        countEntry(src);
        directories += 1;
        mkdirSync(dst, { recursive: true });
        stageDirectory(src, dst);
        continue;
      }
      if (stats.isFile()) {
        countEntry(src);
        files += 1;
        if (existsSync(dst)) {
          fail(`stageRuntimeTree: conflicting mapping — destination already exists: ${dst}`);
        }
        copyFileSync(src, dst);
        continue;
      }
      fail(`stageRuntimeTree: unsupported entry type at ${src} (device/socket/fifo cannot ship in a runtime bundle)`);
    }
  };

  const stageLink = (src, dst, relativeEntry) => {
    let target;
    try {
      target = readlinkSync(src);
    } catch (error) {
      fail(`stageRuntimeTree: unreadable link at ${src}: ${error.code ?? error.message}`);
    }
    const logicalTarget = path.resolve(path.dirname(src), target);
    const targetRelative = path.relative(sourceRoot, logicalTarget);
    const escapes = path.isAbsolute(targetRelative) || targetRelative.startsWith("..");
    if (escapes) {
      // Out-of-tree links (turbopack's Windows native-external marker is the
      // known producer) are reconstructed ONLY from a verified mapping: the
      // target's checkout-relative path must name a REAL entry that also
      // exists inside the tree. First-match-by-name guessing is forbidden.
      const twinSource = resolveExternalTwin({ logicalTarget, allowedExternalRoot, sourceRoot });
      if (twinSource === null) {
        fail(
          `stageRuntimeTree: absolute/escaping link rejected at ${relativeEntry} -> ${target} ` +
            `(resolves to ${logicalTarget}, outside the runtime tree with no verifiable in-tree twin; ` +
            "a portable bundle may only contain in-tree links or mapped reconstructions)",
        );
      }
      if (existsSync(dst)) {
        fail(`stageRuntimeTree: conflicting mapping — reconstruction destination already exists: ${dst} (source link ${relativeEntry})`);
      }
      if (platform === "win32") {
        mkdirSync(dst, { recursive: true });
        materializing.push(twinSource);
        try {
          stageDirectory(twinSource, dst);
        } finally {
          materializing.pop();
        }
        links.push({ path: relativeEntry, target, action: "materialized" });
        return;
      }
      const twinStaged = path.join(destRoot, path.relative(sourceRoot, twinSource));
      const rewritten = path.relative(path.dirname(dst), twinStaged);
      symlinkSync(rewritten, dst);
      links.push({ path: relativeEntry, target: rewritten, action: "reconstructed" });
      return;
    }
    // Link-to-link chains must terminate; an ELOOP-shaped "dangling" report
    // would hide the real defect class, so classify cycles first.
    const chainSeen = new Set([path.resolve(src)]);
    let chainCursor = logicalTarget;
    for (let depth = 0; ; depth += 1) {
      let chainStats;
      try {
        chainStats = lstatSync(chainCursor);
      } catch {
        break;
      }
      if (!chainStats.isSymbolicLink()) {
        break;
      }
      const resolved = path.resolve(path.dirname(chainCursor), readlinkSync(chainCursor));
      if (chainSeen.has(resolved) || depth > 64) {
        fail(`stageRuntimeTree: cyclic link chain rejected at ${relativeEntry} -> ${target}`);
      }
      chainSeen.add(resolved);
      chainCursor = resolved;
    }
    if (!existsSync(logicalTarget)) {
      fail(
        `stageRuntimeTree: dangling link rejected at ${relativeEntry} -> ${target} ` +
          `(resolved target missing: ${logicalTarget})`,
      );
    }
    // A link onto its own ancestor subtree would make materialization copy a
    // directory into itself; a link re-entering a tree already being
    // materialized is the same defect one hop later.
    if (targetRelative === "" || relativeEntry.startsWith(`${targetRelative}${path.sep}`)) {
      fail(`stageRuntimeTree: cyclic link rejected at ${relativeEntry} -> ${target}`);
    }
    if (materializing.includes(logicalTarget)) {
      fail(`stageRuntimeTree: cyclic link rejected at ${relativeEntry} -> ${target} (re-enters ${logicalTarget})`);
    }
    if (existsSync(dst)) {
      fail(`stageRuntimeTree: conflicting mapping — link destination already exists: ${dst} (source link ${relativeEntry})`);
    }
    if (platform === "win32") {
      // The shipped Windows package must be extractable without link
      // creation privileges: materialize the verified in-tree target with
      // the same walker, so containment stays anchored at the tree root.
      mkdirSync(dst, { recursive: true });
      materializing.push(logicalTarget);
      try {
        stageDirectory(logicalTarget, dst);
      } finally {
        materializing.pop();
      }
      links.push({ path: relativeEntry, target, action: "materialized" });
      return;
    }
    symlinkSync(target, dst);
    links.push({ path: relativeEntry, target, action: "preserved" });
  };

  stageDirectory(sourceRoot, destRoot);
  return { files, directories, links };
}

/**
 * A full inventory of a tree: sha256 per file, the raw target per link and
 * every directory. Used to compare staged vs extracted packages — the
 * distribution-boundary check that caught nothing in 025 because it did not
 * exist yet.
 *
 * @param {string} root
 * @returns {{ files: Map<string, string>, links: Map<string, string>, dirs: string[] }}
 */
export function collectTreeInventory(root) {
  const rootPath = path.resolve(root);
  const files = new Map();
  const links = new Map();
  const dirs = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(rootPath, full);
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) {
        links.set(relative, readlinkSync(full));
        continue;
      }
      if (stats.isDirectory()) {
        dirs.push(relative);
        walk(full);
        continue;
      }
      const digest = createHash("sha256").update(readFileSync(full)).digest("hex");
      files.set(relative, digest);
    }
  };
  walk(rootPath);
  return { files, links, dirs };
}

/**
 * Link policy for a FINAL package. win32 tolerates zero links (extraction
 * on end-user machines cannot create junctions); every other platform
 * tolerates exactly the relative, in-tree shape.
 *
 * @returns {string[]} problems (empty = compliant)
 */
export function assertRuntimeLinkPolicy(inventory, { platform }) {
  const problems = [];
  if (platform === "win32") {
    for (const [relative, target] of inventory.links) {
      problems.push(`link policy (win32 packages must be link-free): ${relative} -> ${target}`);
    }
    return problems;
  }
  for (const [relative, target] of inventory.links) {
    if (path.isAbsolute(target)) {
      problems.push(`link policy: absolute link ${relative} -> ${target} (resolves outside any extracted tree)`);
      continue;
    }
    const resolved = path.normalize(path.join(path.dirname(relative), target));
    if (resolved.startsWith("..") || path.isAbsolute(resolved)) {
      problems.push(`link policy: escaping link ${relative} -> ${target}`);
    }
  }
  return problems;
}

/**
 * Compares two inventories of the SAME package (staged vs extracted).
 * Problems name the exact relative path and the class of drift.
 *
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function compareInventories(expected, actual) {
  const problems = [];
  for (const [relative, digest] of expected.files) {
    if (!actual.files.has(relative)) {
      problems.push(`missing from extracted package: ${relative}`);
    } else if (actual.files.get(relative) !== digest) {
      problems.push(`hash mismatch (staged vs extracted): ${relative}`);
    }
  }
  for (const relative of actual.files.keys()) {
    if (!expected.files.has(relative)) {
      problems.push(`extra in extracted package (not staged): ${relative}`);
    }
  }
  for (const [relative, target] of expected.links) {
    if (!actual.links.has(relative)) {
      problems.push(`missing link from extracted package: ${relative}`);
    } else if (actual.links.get(relative) !== target) {
      problems.push(`link target mismatch at ${relative}: staged ${target}, extracted ${actual.links.get(relative)}`);
    }
  }
  for (const relative of actual.links.keys()) {
    if (!expected.links.has(relative)) {
      problems.push(`extra link in extracted package: ${relative} -> ${actual.links.get(relative)}`);
    }
  }
  const expectedDirs = new Set(expected.dirs);
  for (const dir of actual.dirs) {
    if (!expectedDirs.has(dir)) {
      problems.push(`extra directory in extracted package: ${dir}`);
    }
  }
  for (const dir of expectedDirs) {
    if (!actual.dirs.includes(dir)) {
      problems.push(`missing directory from extracted package: ${dir}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
