#!/usr/bin/env node
/**
 * Production standalone API smoke test.
 *
 * Verifies that the built Next.js standalone bundle actually serves the
 * workspace API v1 in production mode: migration SQL assets traced into the
 * bundle, the native better-sqlite3 binary loading, lazy server runtime
 * initialization and SQLite persistence across a server restart.
 *
 * Uses only Node standard library. Requires `next build` to have produced
 * apps/web/.next/standalone first.
 */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(webDir, ".next", "standalone");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Recursively collect paths whose basename matches, skipping node_modules. */
function findByName(dir, basename, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "node_modules") {
      continue;
    }
    const stats = statSync(full);
    if (stats.isDirectory()) {
      findByName(full, basename, out);
    } else if (entry === basename) {
      out.push(full);
    }
  }
  return out;
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

function startServer(serverJs, migrationsDir, dataDir, port) {
  const child = spawn(
    process.execPath,
    [serverJs],
    {
      cwd: path.dirname(serverJs),
      env: {
        ...process.env,
        NODE_ENV: "production",
        VELADESK_DATA_DIR: dataDir,
        VELADESK_MIGRATIONS_DIR: migrationsDir,
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.serverErrorText = stderr;
  return child;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const outcome = await Promise.race([
    exited.then(() => "exited"),
    sleep(3_000).then(() => "timeout"),
  ]);
  if (outcome === "exited") {
    return;
  }
  // A stubborn process gets a final hard stop.
  child.kill("SIGKILL");
  await exited;
}

async function pollUntilReady(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/workspaces`);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`readiness probe status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${lastError?.message ?? "timeout"}`);
}

function minimalSnapshot() {
  return {
    id: "smoke-workspace",
    name: "Smoke Desk",
    pages: [
      {
        id: "page-1",
        name: "Home",
        layout: {
          id: "page-1",
          grid: { columns: 12, rows: 8 },
          items: [],
        },
      },
    ],
    entities: [],
    categories: [],
    dock: { items: [] },
    preferences: { defaultPageId: "page-1", layoutLocked: true },
  };
}

async function main() {
  assert(existsSync(standaloneRoot), `standalone build missing at ${standaloneRoot}; run next build first`);

  const serverJsFiles = findByName(standaloneRoot, "server.js");
  assert(serverJsFiles.length > 0, "no server.js found in standalone output");
  const serverJs = serverJsFiles.find((file) => file.endsWith(path.join("apps", "web", "server.js")));
  assert(serverJs !== undefined, `expected apps/web/server.js, found: ${serverJsFiles.join(", ")}`);
  console.log(`standalone server: ${path.relative(webDir, serverJs)}`);

  const journalFiles = findByName(standaloneRoot, "_journal.json");
  const migrationsDir = journalFiles
    .map((file) => path.dirname(path.dirname(file)))
    .find((dir) => dir.endsWith(path.join("packages", "database", "drizzle")));
  assert(migrationsDir !== undefined, `migration journal not traced into standalone: ${journalFiles}`);
  const migrationSql = readdirSync(migrationsDir).filter((entry) => entry.endsWith(".sql"));
  assert(migrationSql.length > 0, `no migration SQL next to ${migrationsDir}`);
  console.log(`standalone migrations: ${path.relative(webDir, migrationsDir)}`);

  const dataDir = mkdtempSync(path.join(tmpdir(), "veladesk-smoke-"));
  let child;
  try {
    const port = await getFreePort();

    child = startServer(serverJs, migrationsDir, dataDir, port);
    const list = await pollUntilReady(port, 30_000);
    assert(list.headers.get("cache-control") === "no-store", "list response missing Cache-Control: no-store");
    console.log("boot 1: GET /api/v1/workspaces -> 200");

    const created = await fetch(`http://127.0.0.1:${port}/api/v1/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: minimalSnapshot() }),
    });
    assert(created.status === 201, `POST workspace expected 201, got ${created.status}`);
    const createdBody = await created.json();
    assert(createdBody.workspace.revision === 1, `expected revision 1, got ${createdBody.workspace.revision}`);
    console.log("POST workspace -> 201 (revision 1)");

    const fetched = await fetch(`http://127.0.0.1:${port}/api/v1/workspaces/smoke-workspace`);
    assert(fetched.status === 200, `GET workspace expected 200, got ${fetched.status}`);
    const fetchedBody = await fetched.json();
    assert(fetchedBody.workspace.revision === 1, `expected revision 1, got ${fetchedBody.workspace.revision}`);
    console.log("GET workspace -> 200 (revision 1)");

    await stopServer(child);
    child = null;
    console.log("boot 1: stopped");

    const restartPort = await getFreePort();
    child = startServer(serverJs, migrationsDir, dataDir, restartPort);
    await pollUntilReady(restartPort, 30_000);
    const persisted = await fetch(`http://127.0.0.1:${restartPort}/api/v1/workspaces/smoke-workspace`);
    assert(persisted.status === 200, `workspace lost after restart (status ${persisted.status})`);
    const persistedBody = await persisted.json();
    assert(persistedBody.workspace.revision === 1, `expected revision 1 after restart, got ${persistedBody.workspace.revision}`);
    console.log("boot 2: workspace persisted across restart");

    // --- Uploaded assets (task 016-B) -------------------------------------
    const png = makePngBytes();
    const assetId = `asset-sha256-${createHash("sha256").update(png).digest("hex")}`;
    const base3 = `http://127.0.0.1:${restartPort}`;

    const badId = await fetch(`${base3}/api/v1/assets/asset-sha256-not-a-real-id`, { method: "PUT", body: png });
    assert(badId.status === 400, `PUT with a path-shaped id expected 400, got ${badId.status}`);

    const mismatch = await fetch(`${base3}/api/v1/assets/asset-sha256-${"0".repeat(64)}`, { method: "PUT", body: png });
    assert(mismatch.status === 422, `PUT with a foreign id expected 422, got ${mismatch.status}`);

    const created2 = await fetch(`${base3}/api/v1/assets/${assetId}`, { method: "PUT", body: png });
    assert(created2.status === 201, `first asset PUT expected 201, got ${created2.status}`);
    const created2Body = await created2.json();
    assert(created2Body.asset.id === assetId && created2Body.asset.mediaType === "image/png", "asset envelope mismatch");
    console.log("asset PUT -> 201 stored");

    const duplicate = await fetch(`${base3}/api/v1/assets/${assetId}`, { method: "PUT", body: png });
    assert(duplicate.status === 200, `duplicate asset PUT expected 200, got ${duplicate.status}`);
    console.log("asset PUT -> 200 already existed");

    const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
    oversized.set(png);
    const tooLarge = await fetch(`${base3}/api/v1/assets/${assetId}`, { method: "PUT", body: oversized });
    assert(tooLarge.status === 413, `oversized asset PUT expected 413, got ${tooLarge.status}`);

    const readBack = await fetch(`${base3}/api/v1/assets/${assetId}`);
    assert(readBack.status === 200, `asset GET expected 200, got ${readBack.status}`);
    assert(readBack.headers.get("content-type") === "image/png", "asset GET content-type mismatch");
    assert(
      readBack.headers.get("cache-control") === "public, max-age=31536000, immutable",
      "asset GET cache-control mismatch"
    );
    assert(readBack.headers.get("etag") === `"${assetId}"`, "asset GET etag mismatch");
    const readBytes = new Uint8Array(await readBack.arrayBuffer());
    assert(bytesEqual(readBytes, png), "asset GET bytes differ from the PUT body");
    console.log("asset GET -> exact bytes, type, immutable cache, etag");

    const head = await fetch(`${base3}/api/v1/assets/${assetId}`, { method: "HEAD" });
    assert(head.status === 200, `asset HEAD expected 200, got ${head.status}`);
    assert(head.headers.get("content-length") === String(png.byteLength), "asset HEAD content-length mismatch");
    assert((await head.arrayBuffer()).byteLength === 0, "asset HEAD must have no body");
    console.log("asset HEAD -> metadata only");

    // --- Restart: assets live in VELADESK_DATA_DIR/assets -----------------
    await stopServer(child);
    child = null;

    const restartPort2 = await getFreePort();
    child = startServer(serverJs, migrationsDir, dataDir, restartPort2);
    await pollUntilReady(restartPort2, 30_000);
    const readAfterRestart = await fetch(`http://127.0.0.1:${restartPort2}/api/v1/assets/${assetId}`);
    assert(readAfterRestart.status === 200, `asset GET after restart expected 200, got ${readAfterRestart.status}`);
    const bytesAfterRestart = new Uint8Array(await readAfterRestart.arrayBuffer());
    assert(bytesEqual(bytesAfterRestart, png), "asset bytes lost across restart");
    const headAfterRestart = await fetch(`http://127.0.0.1:${restartPort2}/api/v1/assets/${assetId}`, { method: "HEAD" });
    assert(headAfterRestart.status === 200, "asset HEAD after restart expected 200");
    console.log("boot 3: asset persisted across restart (VELADESK_DATA_DIR/assets)");

    console.log("standalone smoke passed");
  } finally {
    if (child) {
      await stopServer(child);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

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

main().catch((error) => {
  console.error(`standalone smoke failed: ${error.message}`);
  process.exitCode = 1;
});
