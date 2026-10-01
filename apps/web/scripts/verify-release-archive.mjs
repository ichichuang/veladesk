#!/usr/bin/env node
/**
 * Release archive round-trip verifier (task 027-R2).
 *
 * Verifies the ARCHIVE — the thing users download — not merely the staging
 * directory it was built from:
 *
 *   1. extract the exact archive into a caller-chosen directory (the
 *      release workflow uses a RUNNER_TEMP path with spaces and non-ASCII
 *      characters, so path handling is proven on every platform);
 *   2. compare the staged and extracted inventories file-for-file with
 *      sha256 hashes — hidden files and dot-directories included
 *      (Compress-Archive's documented hidden-file exclusion is why the
 *      Windows zip is built with bsdtar instead, and why its output is
 *      verified here rather than trusted);
 *   3. enforce the package link policy on the EXTRACTED tree (win32: zero
 *      links; unix: relative in-tree only), rejecting broken links,
 *      absolute links back to a runner workspace, and links escaping the
 *      runtime;
 *   4. assert the unix launcher kept its executable bit through the archive,
 *      and that native .node binaries, migration SQL and the LICENSE all
 *      made the trip.
 *
 * Extraction uses the system tar (bsdtar reads both tar.gz and zip on the
 * runners). NEVER starts a server.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertRuntimeLinkPolicy, collectTreeInventory, compareInventories } from "./runtime-stage.mjs";

/**
 * The tar binary to invoke. On Windows the release step may run under a
 * git-bash whose PATH prefers msys GNU tar (which cannot read zip), so the
 * SYSTEM bsdtar is pinned explicitly.
 */
export function defaultTarCommand() {
  if (process.platform === "win32") {
    return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  }
  return "tar";
}

/**
 * @param {object} input
 * @param {string} input.archive Path to the exact archive file.
 * @param {string} input.stagedDir The staged package directory the archive
 *   was created from (its basename must be the archive's single root entry).
 * @param {string} input.extractRoot Directory to extract into (created; must
 *   be outside both the archive's and the staged tree's parents).
 * @param {string} [input.platform]
 * @param {string} [input.tarCommand]
 * @param {import("node:child_process").SpawnSyncOptions["shell"]} [input.shell]
 * @returns {{ ok: boolean, problems: string[], extractedPackageDir: string | null, fileCount: number, linkCount: number }}
 */
export function verifyReleaseArchive({
  archive,
  stagedDir,
  extractRoot,
  platform = process.platform,
  tarCommand = defaultTarCommand(),
  shell,
}) {
  const archivePath = path.resolve(archive);
  const stagedPath = path.resolve(stagedDir);
  const extractPath = path.resolve(extractRoot);
  const problems = [];

  if (!existsSync(archivePath)) {
    return { ok: false, problems: [`archive missing: ${archivePath}`], extractedPackageDir: null, fileCount: 0, linkCount: 0 };
  }
  const archiveInsideStaged = stagedPath === archivePath || archivePath.startsWith(stagedPath + path.sep);
  const extractInsideStaged = extractPath === stagedPath || extractPath.startsWith(stagedPath + path.sep);
  const stagedInsideExtract = stagedPath.startsWith(extractPath + path.sep);
  if (archiveInsideStaged || extractInsideStaged || stagedInsideExtract) {
    return {
      ok: false,
      problems: [`extract root must be outside the staged tree (extract=${extractPath}, staged=${stagedPath})`],
      extractedPackageDir: null,
      fileCount: 0,
      linkCount: 0,
    };
  }

  rmSync(extractPath, { recursive: true, force: true });
  mkdirSync(extractPath, { recursive: true });

  // bsdtar.exe takes argv through the ANSI code page: a non-ASCII -C path
  // arrives as '????' and extraction fails (run 36874551422). On win32 the
  // archive is therefore extracted into an ASCII staging directory first
  // and the extracted package is then MOVED — Node's UTF-16 filesystem API
  // — to the caller's spaced, non-ASCII extract root; every later step
  // (inventory, policy, the extracted-package smoke in the workflow) runs
  // against that final path.
  let tarExtractDir = extractPath;
  let packageDirNeedsMove = false;
  if (platform === "win32") {
    tarExtractDir = path.join(path.dirname(extractPath), `veladesk-archive-verify-${process.pid}`);
    rmSync(tarExtractDir, { recursive: true, force: true });
    mkdirSync(tarExtractDir, { recursive: true });
    packageDirNeedsMove = true;
  }

  const extraction = spawnSync(tarCommand, ["-xf", archivePath, "-C", tarExtractDir], {
    encoding: "utf8",
    shell,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (extraction.error || extraction.status !== 0) {
    const reason = extraction.error ? extraction.error.message : `${(extraction.stderr ?? "").slice(0, 2000)}`;
    return {
      ok: false,
      problems: [`extraction failed (${tarCommand} -xf ${archivePath}): ${reason}`],
      extractedPackageDir: null,
      fileCount: 0,
      linkCount: 0,
    };
  }

  const topEntries = readdirSync(tarExtractDir);
  const expectedRootName = path.basename(stagedPath);
  if (topEntries.length !== 1 || topEntries[0] !== expectedRootName) {
    return {
      ok: false,
      problems: [
        `archive must contain exactly one root entry "${expectedRootName}", found: ${topEntries.join(", ") || "(empty)"}`,
      ],
      extractedPackageDir: null,
      fileCount: 0,
      linkCount: 0,
    };
  }
  let extractedPackageDir = path.join(tarExtractDir, expectedRootName);
  if (packageDirNeedsMove) {
    const finalDir = path.join(extractPath, expectedRootName);
    renameSync(extractedPackageDir, finalDir);
    rmSync(tarExtractDir, { recursive: true, force: true });
    extractedPackageDir = finalDir;
  }

  const stagedInventory = collectTreeInventory(stagedPath);
  const extractedInventory = collectTreeInventory(extractedPackageDir);
  const comparison = compareInventories(stagedInventory, extractedInventory);
  problems.push(...comparison.problems);
  for (const problem of assertRuntimeLinkPolicy(extractedInventory, { platform })) {
    problems.push(problem);
  }

  // Required classes of content — named, so a silent archive gap names the
  // missing class instead of only a path nobody recognizes.
  const relativeFiles = [...extractedInventory.files.keys()];
  if (!relativeFiles.some((file) => file.endsWith(".node"))) {
    problems.push("no native .node binaries in the extracted runtime (better-sqlite3 lost)");
  }
  if (!relativeFiles.some((file) => file.startsWith(path.join("runtime", "packages", "database", "drizzle")) && file.endsWith(".sql"))) {
    problems.push("no migration SQL files under runtime/packages/database/drizzle");
  }
  if (!relativeFiles.includes("LICENSE")) {
    problems.push("LICENSE missing from the extracted package");
  }
  if (!relativeFiles.some((file) => file.startsWith(path.join("runtime", "apps", "web", ".next")))) {
    problems.push("no compiled .next assets under runtime/apps/web/.next");
  }

  const launcher = platform === "win32" ? "start-veladesk.cmd" : "start-veladesk.sh";
  const launcherPath = path.join(extractedPackageDir, launcher);
  if (!existsSync(launcherPath)) {
    problems.push(`${launcher} missing from the extracted package`);
  } else if (platform !== "win32") {
    const mode = lstatSync(launcherPath).mode;
    if ((mode & 0o111) === 0) {
      problems.push(`${launcher} lost its executable bit through the archive`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    extractedPackageDir,
    fileCount: extractedInventory.files.size,
    linkCount: extractedInventory.links.size,
  };
}

function main(argv) {
  const archive = argv[0];
  const stagedDir = argv[1];
  const extractRootIndex = argv.indexOf("--extract-root");
  const extractRoot = extractRootIndex !== -1 ? argv[extractRootIndex + 1] : undefined;
  if (archive === undefined || stagedDir === undefined || extractRoot === undefined) {
    console.error("usage: node verify-release-archive.mjs <archive> <staged-package-dir> --extract-root <dir>");
    process.exitCode = 1;
    return;
  }
  const result = verifyReleaseArchive({ archive, stagedDir, extractRoot });
  for (const problem of result.problems) {
    console.error(`  - ${problem}`);
  }
  if (!result.ok) {
    console.error(`archive verification FAILED: ${result.problems.length} problem(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `archive verified: ${result.fileCount} files, ${result.linkCount} links — byte-identical to the staged package`,
  );
  console.log(`extracted: ${result.extractedPackageDir}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `extracted_package_dir=${result.extractedPackageDir}\n`);
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2));
}
