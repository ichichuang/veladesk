#!/usr/bin/env node
/**
 * Task 018 browser-suite server: runs the PRODUCTION standalone build on a
 * fixed port with static assets freshly copied, an isolated temp data dir,
 * and strict own-process lifecycle (SIGTERM → child only; never a broad
 * port sweep).
 *
 * Prerequisites: `pnpm build` has produced apps/web/.next/standalone.
 * Usage: PORT=3131 node scripts/e2e-standalone-server.mjs
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(webDir, ".next", "standalone");
const standaloneApp = path.join(standaloneRoot, "apps", "web");
const serverJs = path.join(standaloneApp, "server.js");
const PORT = Number(process.env.PORT ?? 3131);

function fail(message) {
  console.error(`e2e-server: ${message}`);
  process.exit(1);
}

if (!existsSync(serverJs)) {
  fail(`standalone build missing (${serverJs}); run pnpm build first`);
}

// The migration folder is discovered relative to the standalone root.
// Serve the same static assets the deployment serves: copy .next/static
// and public INTO the standalone tree (Next standalone does not include
// them by design). Fresh copy every run — no stale chunks between builds.
cpSync(path.join(webDir, ".next", "static"), path.join(standaloneApp, ".next", "static"), {
  recursive: true,
});
cpSync(path.join(webDir, "public"), path.join(standaloneApp, "public"), {
  recursive: true,
});

const journalFiles = (() => {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "_journal.json") out.push(full);
    }
  };
  walk(standaloneRoot);
  return out;
})();
const migrationsDir = journalFiles
  .map((file) => path.dirname(path.dirname(file)))
  .find((dir) => dir.endsWith(path.join("packages", "database", "drizzle")));
if (migrationsDir === undefined) {
  fail("migration journal not traced into the standalone bundle");
}

const dataDir = mkdtempSync(path.join(tmpdir(), "veladesk-e2e-"));

function assertPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => {
      fail(`port ${port} is already in use — refusing to touch an unknown process`);
    });
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(port, "127.0.0.1");
  });
}

async function main() {
  await assertPortFree(PORT);

  const child = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env: {
      ...process.env,
      NODE_ENV: "production",
      VELADESK_DATA_DIR: dataDir,
      VELADESK_MIGRATIONS_DIR: migrationsDir,
      HOSTNAME: "127.0.0.1",
      PORT: String(PORT),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const shutdown = (signal) => {
    if (child.exitCode === null) {
      child.kill(signal === "SIGINT" ? "SIGTERM" : signal);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGTERM"));
  child.on("exit", (code) => {
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(code ?? 0);
  });
}

await main();
