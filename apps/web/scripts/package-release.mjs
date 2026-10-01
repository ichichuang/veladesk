#!/usr/bin/env node
/**
 * VelaDesk release packager (task 025 §24–§33).
 *
 * Consumes an ALREADY-BUILT Next standalone tree (apps/web/.next/standalone
 * — this script never runs `next build`) and assembles the self-hosted
 * release directory:
 *
 *   VelaDesk-vX.Y.Z-<platform>-<arch>/
 *     VERSION                      ← derived from the ROOT package.json
 *     LICENSE                      ← repo root LICENSE
 *     START.md                     ← how to run
 *     start-veladesk.cmd | .sh     ← platform launcher (real process.platform)
 *     runtime/                     ← the full standalone tree, with
 *       apps/web/.next/static      ← copied explicitly (Next does not)
 *       apps/web/public            ← copied explicitly
 *       packages/database/drizzle  ← migrations, at a FIXED path the
 *                                     launcher and verifier both rely on
 *
 * Platform/arch names come from the actual process — never guessed, never
 * duplicated in the workflow (the archive name is emitted once, here).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readRootVersion } from "../../../scripts/version-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "../..");

/** User-facing platform label (win32→windows, darwin→macos). */
export function platformLabel(platform = process.platform) {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "macos";
  }
  return platform;
}

/** Archive extension per platform: zip on Windows, tar.gz elsewhere. */
export function archiveExtension(platform = process.platform) {
  return platform === "win32" ? "zip" : "tar.gz";
}

/** e.g. `VelaDesk-v1.2.0-macos-arm64` — the ONE naming rule (task §25/§38). */
export function releaseDirectoryBase(version, platform = process.platform, arch = process.arch) {
  return `VelaDesk-v${version}-${platformLabel(platform)}-${arch}`;
}

/** e.g. `VelaDesk-v1.2.0-macos-arm64.tar.gz`. */
export function releaseArchiveName(version, platform = process.platform, arch = process.arch) {
  return `${releaseDirectoryBase(version, platform, arch)}.${archiveExtension(platform)}`;
}

/** Recursively collects matching basenames, skipping node_modules. */
function findByName(dir, basename, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      findByName(full, basename, out);
    } else if (entry === basename) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Locates the standalone server.js. The launcher, the verifier and this
 * packager all pin the SAME release contract — runtime/apps/web/server.js —
 * so a probed layout that is anything else fails the packaging loudly
 * instead of shipping a bundle the launcher cannot boot.
 */
function locateStandaloneServer(standaloneRoot) {
  const candidates = findByName(standaloneRoot, "server.js");
  const serverJs = candidates.find((file) => file.endsWith(path.join("apps", "web", "server.js")));
  if (serverJs === undefined) {
    throw new Error(
      `expected standalone layout apps/web/server.js (monorepo tracing root); found: ${
        candidates.length === 0 ? "no server.js at all" : candidates.join(", ")
      }`,
    );
  }
  return serverJs;
}

/**
 * Locates the traced migration tree (…/drizzle/meta/_journal.json) and
 * returns its drizzle root. Throws with the found locations when absent.
 */
function locateMigrations(standaloneRoot) {
  const journals = findByName(standaloneRoot, "_journal.json");
  const journal = journals.find((file) => path.dirname(path.dirname(file)).endsWith(path.join("packages", "database", "drizzle")))
    ?? journals[0];
  if (journal === undefined) {
    throw new Error(`migration journal (_journal.json) not traced into ${standaloneRoot}`);
  }
  return path.dirname(path.dirname(journal));
}

const START_MD = (version) => `# VelaDesk ${version}

Requirements:

- Node.js 24 LTS

Windows:

    start-veladesk.cmd

macOS / Linux:

    ./start-veladesk.sh

Then open http://127.0.0.1:3000

Data directory (kept when you upgrade — the app directory and your data are separate):

- Windows: %LOCALAPPDATA%\\VelaDesk
- macOS: ~/Library/Application Support/VelaDesk
- Linux: \${XDG_DATA_HOME:-~/.local/share}/veladesk

Upgrading: download the new release, extract it to a new folder (or replace
the old app folder) and keep using the same data directory — your workspace
data is never stored inside the app folder.

Issues: https://github.com/ichichuang/veladesk/issues
`;

const CMD_LAUNCHER = `@echo off
rem VelaDesk self-hosted launcher (generated at package time).
setlocal
set "DIR=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo VelaDesk requires Node.js 24 LTS.
  exit /b 1
)

rem Loopback-only by default. VELADESK_HOST / VELADESK_PORT are the user
rem overrides (HOSTNAME itself is unreliable in shells).
if "%VELADESK_HOST%"=="" (set "HOSTNAME=127.0.0.1") else (set "HOSTNAME=%VELADESK_HOST%")
if "%VELADESK_PORT%"=="" (set "PORT=3000") else (set "PORT=%VELADESK_PORT%")

if "%VELADESK_DATA_DIR%"=="" set "VELADESK_DATA_DIR=%LOCALAPPDATA%\\VelaDesk"
set "VELADESK_MIGRATIONS_DIR=%DIR%runtime\\packages\\database\\drizzle"
set "NODE_ENV=production"

cd /d "%DIR%runtime\\apps\\web" || exit /b 1
node server.js
exit /b %ERRORLEVEL%
`;

const SH_LAUNCHER = `#!/bin/sh
# VelaDesk self-hosted launcher (generated at package time).
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "VelaDesk requires Node.js 24 LTS." >&2
  exit 1
fi

# Loopback-only by default. VELADESK_HOST / VELADESK_PORT are the user
# overrides; the shell's HOSTNAME value is deliberately never inherited.
if [ -n "\${VELADESK_HOST:-}" ]; then
  HOSTNAME="$VELADESK_HOST"
else
  HOSTNAME=127.0.0.1
fi
export HOSTNAME
if [ -n "\${VELADESK_PORT:-}" ]; then
  PORT="$VELADESK_PORT"
else
  PORT=3000
fi
export PORT

if [ "$(uname)" = "Darwin" ]; then
  DATA_DIR="\${VELADESK_DATA_DIR:-$HOME/Library/Application Support/VelaDesk}"
else
  DATA_DIR="\${VELADESK_DATA_DIR:-\${XDG_DATA_HOME:-$HOME/.local/share}/veladesk}"
fi
export VELADESK_DATA_DIR="$DATA_DIR"
export VELADESK_MIGRATIONS_DIR="$DIR/runtime/packages/database/drizzle"
export NODE_ENV=production

cd "$DIR/runtime/apps/web"
exec node server.js
`;

/**
 * Assembles the release staging directory.
 *
 * @param {object} args
 * @param {string} args.version Release version (must match the root manifest).
 * @param {string} args.webDir The apps/web directory (build tree owner).
 * @param {string} args.outDir Destination root; the staging directory is
 *   created inside it.
 */
export function packageRelease({ version, webDir = webDirDefault(), outDir }) {
  const standaloneRoot = path.join(webDir, ".next", "standalone");
  const staticDir = path.join(webDir, ".next", "static");
  const publicDir = path.join(webDir, "public");
  if (!existsSync(standaloneRoot)) {
    throw new Error(`standalone build missing at ${standaloneRoot}; run next build first (this script never builds)`);
  }
  if (!existsSync(staticDir)) {
    throw new Error(`.next/static missing at ${staticDir}; run next build first`);
  }

  const serverJs = locateStandaloneServer(standaloneRoot);
  const serverDir = path.dirname(serverJs);
  const runtimeServerDir = path.join(outDir, "runtime", path.relative(standaloneRoot, serverDir));

  // runtime/ = the complete standalone tree.
  rmSync(path.join(outDir, "runtime"), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(standaloneRoot, path.join(outDir, "runtime"), { recursive: true });

  // Next standalone never guarantees these two — copy them beside server.js.
  cpSync(staticDir, path.join(runtimeServerDir, ".next", "static"), { recursive: true });
  if (existsSync(publicDir)) {
    cpSync(publicDir, path.join(runtimeServerDir, "public"), { recursive: true });
  }

  // Migrations at the FIXED path the launcher and verifier rely on.
  const migrationsSource = locateMigrations(standaloneRoot);
  cpSync(migrationsSource, path.join(outDir, "runtime", "packages", "database", "drizzle"), {
    recursive: true,
  });

  // Derived release metadata files.
  writeFileSync(path.join(outDir, "VERSION"), `${version}\n`, "utf8");
  const license = path.join(repoRootOf(webDir), "LICENSE");
  if (!existsSync(license)) {
    throw new Error(`LICENSE not found at ${license}`);
  }
  cpSync(license, path.join(outDir, "LICENSE"));
  writeFileSync(path.join(outDir, "START.md"), START_MD(version), "utf8");
  const launcherName = process.platform === "win32" ? "start-veladesk.cmd" : "start-veladesk.sh";
  const launcherSource = process.platform === "win32" ? CMD_LAUNCHER : SH_LAUNCHER;
  writeFileSync(path.join(outDir, launcherName), launcherSource, "utf8");

  return {
    version,
    directory: outDir,
    platform: platformLabel(),
    arch: process.arch,
    archiveName: releaseArchiveName(version),
  };
}

function webDirDefault() {
  return webDir;
}

function repoRootOf(webDirFromCaller) {
  return path.resolve(webDirFromCaller, "../..");
}

function main() {
  const outArgIndex = process.argv.indexOf("--out");
  // --out names the directory that will CONTAIN the package directory.
  const outParent =
    outArgIndex !== -1 ? path.resolve(process.argv[outArgIndex + 1]) : path.join(webDir, "dist");
  const version = readRootVersion(repoRoot);
  const packageDir = path.join(outParent, releaseDirectoryBase(version));
  rmSync(packageDir, { recursive: true, force: true });
  const manifest = packageRelease({ version, outDir: packageDir });
  writeFileSync(
    path.join(outParent, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`VelaDesk release package: ${manifest.directory}`);
  console.log(`Archive name: ${manifest.archiveName}`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
