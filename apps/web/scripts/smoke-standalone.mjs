#!/usr/bin/env node
/**
 * Production standalone smoke test — now with a package mode (task 027-R2).
 *
 * Dev mode (default, unchanged behavior for CI's normal production smoke):
 * verifies the built Next standalone tree under apps/web/.next/standalone —
 * workspace API v1, migration SQL assets, native better-sqlite3, SQLite
 * persistence across restarts, the bundled icon catalog and the asset
 * round-trip, plus a server-rendered home page fetch.
 *
 * Package mode (--runtime <package-dir>, used against EXTRACTED release
 * archives by the Release workflow): the SAME suite, plus the checks that
 * only make sense at the distribution boundary — packaged CSS/JS and the
 * public brand asset served byte-exactly, shared React resolution from the
 * application and renderer contexts resolving inside the package, the native
 * database binary loading from inside the package, and (with --launcher)
 * booting through the real platform launcher using only its documented
 * VELADESK_PORT / VELADESK_DATA_DIR overrides.
 *
 * There is NO silent fallback between modes: --runtime derives every path
 * from the given package directory and fails if any expected piece is
 * missing; without it the script looks ONLY at apps/web/.next/standalone.
 *
 * The orchestration is seam-injectable end to end (spawn/fetch/clock/probe)
 * so unit tests drive the real suite with fake children — never a server.
 */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServerHandle, pollUntilReady } from "./smoke-readiness.mjs";

const webDirDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Recursively collect paths whose basename matches, skipping node_modules. */
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

/** First file matching a suffix under `dir`, in deterministic sorted order. */
function firstFileWithSuffix(dir, suffix) {
  const found = firstFileMatching(dir, (name) => name.endsWith(suffix));
  return found;
}

/** First non-hidden IMAGE file under `dir` — a real servable brand asset. */
function firstPublicImage(dir) {
  return firstFileMatching(dir, (name) => {
    if (name.startsWith(".")) {
      return false;
    }
    return /\.(png|jpe?g|webp|svg|ico|avif)$/i.test(name);
  });
}

function firstFileMatching(dir, predicate) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.shift();
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        stack.push(full);
      } else if (predicate(entry)) {
        return full;
      }
    }
    stack.sort();
  }
  return null;
}

/* ───────────────────────────── path selection ─────────────────────────── */

/**
 * ONE options-object interface for the CLI adapter, the orchestration and
 * the tests.
 *
 * @param {object} options
 * @param {string} [options.runtimeRoot] Extracted release PACKAGE directory
 *   (contains runtime/, launcher, VERSION). Package mode — required pieces
 *   are asserted, never silently derived elsewhere.
 * @param {string} [options.webDir] Dev mode anchor (defaults to this app).
 * @returns {{
 *   mode: "dev" | "package",
 *   packageDir: string | null,
 *   serverJs: string,
 *   migrationsDir: string,
 *   staticDir: string | null,
 *   publicDir: string | null,
 *   launcherPath: string | null,
 * }}
 */
export function resolveSmokePaths({ runtimeRoot, webDir } = {}) {
  if (runtimeRoot !== undefined) {
    const packageDir = path.resolve(runtimeRoot);
    const runtimeDir = path.join(packageDir, "runtime");
    const serverJs = path.join(runtimeDir, "apps", "web", "server.js");
    const migrationsDir = path.join(runtimeDir, "packages", "database", "drizzle");
    const staticDir = path.join(runtimeDir, "apps", "web", ".next", "static");
    const publicDir = path.join(runtimeDir, "apps", "web", "public");
    const launcherPath = path.join(
      packageDir,
      process.platform === "win32" ? "start-veladesk.cmd" : "start-veladesk.sh",
    );
    const required = [
      ["runtime/apps/web/server.js", serverJs],
      ["runtime/packages/database/drizzle", migrationsDir],
      ["runtime/apps/web/.next/static", staticDir],
      ["runtime/apps/web/public", publicDir],
      ["platform launcher", launcherPath],
    ];
    for (const [label, location] of required) {
      if (!existsSync(location)) {
        throw new Error(`--runtime package incomplete: ${label} missing at ${location}`);
      }
    }
    return { mode: "package", packageDir, serverJs, migrationsDir, staticDir, publicDir, launcherPath };
  }

  const resolvedWebDir = path.resolve(webDir ?? webDirDefault);
  const standaloneRoot = path.join(resolvedWebDir, ".next", "standalone");
  assert(existsSync(standaloneRoot), `standalone build missing at ${standaloneRoot}; run next build first`);

  const serverJsFiles = findByName(standaloneRoot, "server.js");
  assert(serverJsFiles.length > 0, "no server.js found in standalone output");
  const serverJs = serverJsFiles.find((file) => file.endsWith(path.join("apps", "web", "server.js")));
  assert(serverJs !== undefined, `expected apps/web/server.js, found: ${serverJsFiles.join(", ")}`);

  const journalFiles = findByName(standaloneRoot, "_journal.json");
  const migrationsDir = journalFiles
    .map((file) => path.dirname(path.dirname(file)))
    .find((dir) => dir.endsWith(path.join("packages", "database", "drizzle")));
  assert(migrationsDir !== undefined, `migration journal not traced into standalone: ${journalFiles}`);
  return {
    mode: "dev",
    packageDir: null,
    serverJs,
    migrationsDir,
    staticDir: null,
    publicDir: null,
    launcherPath: null,
  };
}

/* ──────────────────────────── real spawn seams ────────────────────────── */

function buildServerEnv(targets, { dataDir, port }) {
  return {
    ...process.env,
    NODE_ENV: "production",
    VELADESK_DATA_DIR: dataDir,
    VELADESK_MIGRATIONS_DIR: targets.migrationsDir,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
  };
}

/** Boots the raw server.js (dev mode and package non-launcher mode). */
export function startServerJs(targets, { dataDir, port }) {
  const child = spawn(process.execPath, [targets.serverJs], {
    cwd: path.dirname(targets.serverJs),
    env: buildServerEnv(targets, { dataDir, port }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return createServerHandle(child);
}

/**
 * Boots through the REAL platform launcher with only the documented user
 * overrides (test port + isolated data dir) — the path a self-hoster takes.
 */
export function startServerLauncher(targets, { dataDir, port }) {
  if (process.platform === "win32") {
    const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", targets.launcherPath], {
      cwd: targets.packageDir,
      env: { ...process.env, VELADESK_DATA_DIR: dataDir, VELADESK_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return createServerHandle(child);
  }
  const child = spawn("sh", [targets.launcherPath], {
    cwd: targets.packageDir,
    env: { ...process.env, VELADESK_DATA_DIR: dataDir, VELADESK_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return createServerHandle(child);
}

function defaultStartServer(targets, boot) {
  return boot.launcher ? startServerLauncher(targets, boot) : startServerJs(targets, boot);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopServer(server, child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const outcome = await Promise.race([exited.then(() => "exited"), sleep(3_000).then(() => "timeout")]);
  if (outcome === "exited") {
    return;
  }
  if (process.platform === "win32" && child.pid !== undefined) {
    // cmd.exe wrappers leave a node grandchild behind; the tree kill targets
    // ONLY this job's own child pid. This code runs on disposable runners
    // (the Release workflow) — never as part of local unit tests.
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8" });
    await exited;
    return;
  }
  child.kill("SIGKILL");
  await exited;
}

/** Runs a bounded `node -e` probe anchored at VELADESK_PROBE_DIR; returns stdout. */
async function defaultNodeProbe(script, { cwd, probeDir }) {
  const child = spawn(process.execPath, ["-e", script], {
    cwd,
    env: { ...process.env, VELADESK_PROBE_DIR: probeDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.once("exit", (exitCode) => resolve(exitCode)));
  if (code !== 0) {
    throw new Error(`node probe failed (exit ${code}): ${stderr.slice(0, 2000)}`);
  }
  return stdout.trim();
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/* ───────────────────────────── the suite ──────────────────────────────── */

function minimalSnapshot() {
  return {
    id: "smoke-workspace",
    name: "Smoke Desk",
    pages: [
      {
        id: "page-1",
        name: "Home",
        layout: { id: "page-1", grid: { columns: 12, rows: 8 }, items: [] },
      },
    ],
    entities: [],
    categories: [],
    dock: { items: [] },
    preferences: { defaultPageId: "page-1", layoutLocked: true },
  };
}

/**
 * The full smoke orchestration. Every effect is a seam: tests drive this
 * with fake children/fetch/clock; the CLI drives the real ones.
 *
 * @param {object} options
 * @param {ReturnType<typeof resolveSmokePaths>} options.targets
 * @param {boolean} [options.launcher] Boot through the platform launcher
 *   (package mode only).
 * @param {number} [options.deadlineMs] Readiness deadline (kept at 30s).
 * @param {(targets: object, boot: { dataDir: string, port: number, launcher: boolean }) => object} [options.startServerImpl]
 * @param {(url: string) => Promise<Response>} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleepImpl]
 * @param {() => number} [options.now]
 * @param {() => Promise<number>} [options.getFreePortImpl]
 * @param {(script: string, opts: { cwd: string }) => Promise<string>} [options.nodeProbeImpl]
 */
export async function runStandaloneSmoke(options) {
  const {
    targets,
    launcher = false,
    deadlineMs = 30_000,
    startServerImpl = defaultStartServer,
    fetchImpl = fetch,
    sleepImpl = sleep,
    now = () => Date.now(),
    getFreePortImpl = getFreePort,
    nodeProbeImpl = defaultNodeProbe,
  } = options;

  if (launcher && targets.mode !== "package") {
    throw new Error("--launcher requires --runtime (the launcher lives in the release package)");
  }

  const log = (...args) => console.log(...args);
  const readiness = { serverPath: targets.serverJs, migrationsPath: targets.migrationsDir };
  const dataDir = mkdtempSync(path.join(tmpdir(), "veladesk-smoke-"));
  let server;
  try {
    const boot = async () => {
      const port = await getFreePortImpl();
      server = startServerImpl(targets, { dataDir, port, launcher });
      await pollUntilReady({
        server,
        url: `http://127.0.0.1:${port}/api/v1/workspaces`,
        deadlineMs,
        fetchImpl,
        sleep: sleepImpl,
        now,
        diagnostics: readiness,
      });
      return port;
    };

    const port = await boot();
    const base = `http://127.0.0.1:${port}`;

    const list = await fetchImpl(`${base}/api/v1/workspaces`);
    assert(list.headers.get("cache-control") === "no-store", "list response missing Cache-Control: no-store");
    log("boot 1: GET /api/v1/workspaces -> 200");

    const created = await fetchImpl(`${base}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: minimalSnapshot() }),
    });
    assert(created.status === 201, `POST workspace expected 201, got ${created.status}`);
    const createdBody = await created.json();
    assert(createdBody.workspace.revision === 1, `expected revision 1, got ${createdBody.workspace.revision}`);
    log("POST workspace -> 201 (revision 1)");

    const fetched = await fetchImpl(`${base}/api/v1/workspaces/smoke-workspace`);
    assert(fetched.status === 200, `GET workspace expected 200, got ${fetched.status}`);
    const fetchedBody = await fetched.json();
    assert(fetchedBody.workspace.revision === 1, `expected revision 1, got ${fetchedBody.workspace.revision}`);
    log("GET workspace -> 200 (revision 1)");

    await stopServer(server, server.child);
    server = null;
    log("boot 1: stopped");

    // ---- boot 2: SQLite persistence across a real restart ----------------
    const restartPort = await boot();
    const restartBase = `http://127.0.0.1:${restartPort}`;
    const persisted = await fetchImpl(`${restartBase}/api/v1/workspaces/smoke-workspace`);
    assert(persisted.status === 200, `workspace lost after restart (status ${persisted.status})`);
    const persistedBody = await persisted.json();
    assert(persistedBody.workspace.revision === 1, `expected revision 1 after restart, got ${persistedBody.workspace.revision}`);
    log("boot 2: workspace persisted across restart");

    // --- Bundled icon catalog (tasks 016-A / 016-C) -----------------------
    const iconBase = restartBase;
    const recommended = await fetchImpl(`${iconBase}/api/v1/icons/search`);
    assert(recommended.status === 200, `recommended search expected 200, got ${recommended.status}`);
    const recommendedBody = await recommended.json();
    assert(recommendedBody.icons[0]?.id === "simple-icons:github", "recommended page must lead with a real brand icon");
    assert(recommendedBody.nextOffset === null, "the curated page must fit in one page");
    log(`icon search (recommended) -> ${recommendedBody.icons.length} curated icons`);

    const all = await fetchImpl(`${iconBase}/api/v1/icons/search?scope=all&limit=96`);
    assert(all.status === 200, `scope=all expected 200, got ${all.status}`);
    const allBody = await all.json();
    assert(allBody.icons.length === 96, `expected 96 icons, got ${allBody.icons.length}`);
    assert(allBody.total > 300, `expected the real catalog, total=${allBody.total}`);
    assert(allBody.nextOffset === 96, `expected nextOffset 96, got ${allBody.nextOffset}`);
    const page3 = await fetchImpl(`${iconBase}/api/v1/icons/search?scope=all&limit=96&offset=192`);
    const page3Body = await page3.json();
    const page1Ids = new Set(allBody.icons.map((icon) => icon.id));
    assert(page3Body.icons.every((icon) => !page1Ids.has(icon.id)), "paged results must not repeat an earlier page");
    assert(page3Body.total === allBody.total, "total must be page-independent");
    log(`icon search scope=all -> 3 pages of 96 out of ${allBody.total}`);

    const color = await fetchImpl(`${iconBase}/api/v1/icons/search?scope=color&limit=120`);
    const colorBody = await color.json();
    assert(colorBody.icons.every((icon) => icon.palette === "multicolor"), "scope=color must only return multicolor palettes");

    const samples = [
      ["simple-icons", "github", "monochrome"],
      ["lucide", "terminal", "monochrome"],
      ["tabler", "server", "monochrome"],
      ["ph", "robot", "monochrome"],
      ["fluent-color", "mail-24", "multicolor"],
      ["devicon", "docker", "multicolor"],
      ["vscode-icons", "file-type-reactjs", "multicolor"],
      ["catppuccin", "typescript", "multicolor"],
      ["noto", "robot", "multicolor"],
    ];
    for (const [collection, name, palette] of samples) {
      const response = await fetchImpl(`${iconBase}/api/v1/icons/${collection}/${name}.svg`);
      assert(response.status === 200, `${collection}:${name} expected 200, got ${response.status}`);
      assert(
        response.headers.get("content-type") === "image/svg+xml; charset=utf-8",
        `${collection}:${name} content-type mismatch`,
      );
      const svg = await response.text();
      if (palette === "multicolor") {
        assert(/(fill|stroke)="#[0-9a-fA-F]{3,6}"/.test(svg), `${collection} must keep its original colors`);
        assert(!svg.includes("currentColor"), `${collection} must not be flattened to currentColor`);
      } else {
        assert(svg.includes("currentColor"), `${collection} must stay mask-renderable`);
      }
    }
    log(`icon SVG routes -> all ${samples.length} collections 200 with the right palette`);
    log("boot 2: icon catalog served from the standalone bundle");

    // --- Uploaded assets (task 016-B) -------------------------------------
    const png = makePngBytes();
    const assetId = `asset-sha256-${createHash("sha256").update(png).digest("hex")}`;

    const badId = await fetchImpl(`${restartBase}/api/v1/assets/asset-sha256-not-a-real-id`, { method: "PUT", body: png });
    assert(badId.status === 400, `PUT with a path-shaped id expected 400, got ${badId.status}`);

    const mismatch = await fetchImpl(`${restartBase}/api/v1/assets/asset-sha256-${"0".repeat(64)}`, { method: "PUT", body: png });
    assert(mismatch.status === 422, `PUT with a foreign id expected 422, got ${mismatch.status}`);

    const created2 = await fetchImpl(`${restartBase}/api/v1/assets/${assetId}`, { method: "PUT", body: png });
    assert(created2.status === 201, `first asset PUT expected 201, got ${created2.status}`);
    const created2Body = await created2.json();
    assert(created2Body.asset.id === assetId && created2Body.asset.mediaType === "image/png", "asset envelope mismatch");
    log("asset PUT -> 201 stored");

    const duplicate = await fetchImpl(`${restartBase}/api/v1/assets/${assetId}`, { method: "PUT", body: png });
    assert(duplicate.status === 200, `duplicate asset PUT expected 200, got ${duplicate.status}`);
    log("asset PUT -> 200 already existed");

    const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
    oversized.set(png);
    const tooLarge = await fetchImpl(`${restartBase}/api/v1/assets/${assetId}`, { method: "PUT", body: oversized });
    assert(tooLarge.status === 413, `oversized asset PUT expected 413, got ${tooLarge.status}`);

    const readBack = await fetchImpl(`${restartBase}/api/v1/assets/${assetId}`);
    assert(readBack.status === 200, `asset GET expected 200, got ${readBack.status}`);
    assert(readBack.headers.get("content-type") === "image/png", "asset GET content-type mismatch");
    assert(
      readBack.headers.get("cache-control") === "public, max-age=31536000, immutable",
      "asset GET cache-control mismatch",
    );
    assert(readBack.headers.get("etag") === `"${assetId}"`, "asset GET etag mismatch");
    const readBytes = new Uint8Array(await readBack.arrayBuffer());
    assert(bytesEqual(readBytes, png), "asset GET bytes differ from the PUT body");
    log("asset GET -> exact bytes, type, immutable cache, etag");

    const head = await fetchImpl(`${restartBase}/api/v1/assets/${assetId}`, { method: "HEAD" });
    assert(head.status === 200, "asset HEAD expected 200");
    assert(head.headers.get("content-length") === String(png.byteLength), "asset HEAD content-length mismatch");
    assert((await head.arrayBuffer()).byteLength === 0, "asset HEAD must have no body");
    log("asset HEAD -> metadata only");

    // --- Restart: assets live in VELADESK_DATA_DIR/assets -----------------
    await stopServer(server, server.child);
    server = null;

    const restartPort2 = await boot();
    const base3 = `http://127.0.0.1:${restartPort2}`;
    const readAfterRestart = await fetchImpl(`${base3}/api/v1/assets/${assetId}`);
    assert(readAfterRestart.status === 200, `asset GET after restart expected 200, got ${readAfterRestart.status}`);
    const bytesAfterRestart = new Uint8Array(await readAfterRestart.arrayBuffer());
    assert(bytesEqual(bytesAfterRestart, png), "asset bytes lost across restart");
    const headAfterRestart = await fetchImpl(`${base3}/api/v1/assets/${assetId}`, { method: "HEAD" });
    assert(headAfterRestart.status === 200, "asset HEAD after restart expected 200");
    log("boot 3: asset persisted across restart (VELADESK_DATA_DIR/assets)");

    // --- Home page: server-rendered HTML (every mode) ---------------------
    const home = await fetchImpl(`${base3}/`);
    assert(home.status === 200, `GET / expected 200, got ${home.status}`);
    assert((home.headers.get("content-type") ?? "").includes("text/html"), "home page content-type must be text/html");
    const homeHtml = await home.text();
    assert(homeHtml.includes("<html"), "home page did not render an HTML document");
    log("GET / -> 200 server-rendered HTML");

    if (targets.mode === "package") {
      await verifyPackagedFrontend({ targets, base: base3, fetchImpl, log });
      await verifyRuntimeContainment({ targets, nodeProbeImpl, log });
    }

    log("standalone smoke passed");
  } finally {
    if (server) {
      await stopServer(server, server.child);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

/* ───────────────── package-mode boundary checks ───────────────────────── */

async function verifyPackagedFrontend({ targets, base, fetchImpl, log }) {
  // A known packaged CSS or JS chunk, served byte-exactly.
  const cssFile = firstFileWithSuffix(targets.staticDir, ".css") ?? firstFileWithSuffix(targets.staticDir, ".js");
  assert(cssFile !== null, `no CSS or JS asset found under ${targets.staticDir}`);
  const relative = path.relative(targets.staticDir, cssFile).split(path.sep).join("/");
  const assetResponse = await fetchImpl(`${base}/_next/static/${relative}`);
  assert(assetResponse.status === 200, `packaged asset /_next/static/${relative} expected 200, got ${assetResponse.status}`);
  const assetBytes = new Uint8Array(await assetResponse.arrayBuffer());
  assert(bytesEqual(assetBytes, new Uint8Array(readFileSync(cssFile))), `packaged asset /_next/static/${relative} bytes differ from the file in the package`);
  log(`GET /_next/static/${relative} -> byte-exact packaged asset`);

  // The public brand resource — a real image, never repo hygiene files
  // like public/.gitkeep (dot-files are skipped on purpose).
  const publicFile = firstPublicImage(targets.publicDir);
  assert(publicFile !== null, `no public image asset found under ${targets.publicDir}`);
  const publicRelative = path.relative(targets.publicDir, publicFile).split(path.sep).join("/");
  const brandResponse = await fetchImpl(`${base}/${publicRelative}`);
  assert(brandResponse.status === 200, `public brand asset /${publicRelative} expected 200, got ${brandResponse.status}`);
  const brandBytes = new Uint8Array(await brandResponse.arrayBuffer());
  assert(bytesEqual(brandBytes, new Uint8Array(readFileSync(publicFile))), `public brand asset /${publicRelative} bytes differ from the package`);
  log(`GET /${publicRelative} -> byte-exact public brand asset`);
}

async function verifyRuntimeContainment({ targets, nodeProbeImpl, log }) {
  const packageDir = targets.packageDir;
  const runtimeDir = realPathOf(path.join(packageDir, "runtime"));
  const insidePackage = (resolved) => {
    const real = realPathOf(resolved);
    return real.startsWith(runtimeDir + path.sep);
  };

  // Shared React from the application and renderer contexts: same physical
  // package, resolved inside the extracted runtime. Next's intentional
  // vendored copies live under next/dist/compiled and are not counted.
  const contexts = [
    path.join(runtimeDir, "apps", "web", ".next", "server"),
    path.join(runtimeDir, "node_modules", "next", "dist"),
  ];
  const resolvedReacts = [];
  for (const context of contexts) {
    const resolved = await nodeProbeImpl(
      "console.log(require.resolve('react', { paths: [process.env.VELADESK_PROBE_DIR] }))",
      { cwd: context, probeDir: context },
    );
    assert(insidePackage(resolved), `react resolved OUTSIDE the package from ${context}: ${resolved}`);
    resolvedReacts.push(realPathOf(resolved));
  }
  assert(
    resolvedReacts[0] === resolvedReacts[1],
    `React identity split across contexts: ${resolvedReacts[0]} vs ${resolvedReacts[1]}`,
  );
  assertPhysicalPackageCount({ runtimeDir, name: "react", expected: 1 });
  assertPhysicalPackageCount({ runtimeDir, name: "react-dom", expected: 1 });
  log(`react resolves to one shared physical package inside the runtime (${path.relative(packageDir, resolvedReacts[0])})`);

  // Native database binary loads from the extracted runtime.
  const serverDir = path.dirname(targets.serverJs);
  const nativeProbe = await nodeProbeImpl(
    [
      "const dir = process.env.VELADESK_PROBE_DIR;",
      "const p = require.resolve('better-sqlite3', { paths: [dir] });",
      "const Database = require(p);",
      "const db = new Database(':memory:');",
      "db.exec('select 1 as ok');",
      "console.log(p);",
    ].join("\n"),
    { cwd: serverDir, probeDir: serverDir },
  );
  assert(insidePackage(nativeProbe), `better-sqlite3 resolved OUTSIDE the package: ${nativeProbe}`);
  log(`native better-sqlite3 loads from inside the runtime (${path.relative(packageDir, realPathOf(nativeProbe))})`);
}

/** probeImpl results arrive as plain paths; realpath them for containment. */
function realPathOf(resolved) {
  return realpathSync(resolved);
}

function assertPhysicalPackageCount({ runtimeDir, name, expected }) {
  const nodeModules = path.join(runtimeDir, "node_modules");
  const found = [];
  const scopes = [nodeModules];
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith("@")) {
      scopes.push(path.join(nodeModules, entry));
    }
  }
  for (const scopeDir of scopes) {
    for (const entry of readdirSync(scopeDir)) {
      const manifest = path.join(scopeDir, entry, "package.json");
      if (!existsSync(manifest)) {
        continue;
      }
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (parsed.name === name) {
        found.push(path.join(scopeDir, entry));
      }
    }
  }
  assert(
    found.length === expected,
    `expected exactly ${expected} physical ${name} package(s) in the runtime (found ${found.length}: ${found.join(", ")})` +
      " — the repair must not duplicate React identities",
  );
}

/* ─────────────────────────────── CLI ──────────────────────────────────── */

function parseArgs(argv) {
  const options = { runtimeRoot: undefined, launcher: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runtime") {
      options.runtimeRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--launcher") {
      options.launcher = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = resolveSmokePaths({ runtimeRoot: options.runtimeRoot });
  console.log(`standalone server: ${targets.serverJs}`);
  console.log(`standalone migrations: ${targets.migrationsDir}`);
  if (targets.mode === "package") {
    console.log(`package mode: ${targets.packageDir}${options.launcher ? " (via the platform launcher)" : ""}`);
  }
  await runStandaloneSmoke({ targets, launcher: options.launcher });
}

/* ─────────────────────────── PNG fixture utils ────────────────────────── */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.slice(4, 8 + data.length)));
  return out;
}

/** Minimal decodable 1×1 RGBA PNG, built from Node stdlib only. */
function makePngBytes() {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1);
  ihdrView.setUint32(4, 1);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Uint8Array.from([0, 200, 200, 200, 255]);
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesEqual(a, b) {
  return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`standalone smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
