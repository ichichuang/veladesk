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

    console.log("standalone smoke passed");
  } finally {
    if (child) {
      await stopServer(child);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`standalone smoke failed: ${error.message}`);
  process.exitCode = 1;
});
