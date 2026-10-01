import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveSmokePaths, runStandaloneSmoke, windowsLauncherCommand } from "./smoke-standalone.mjs";
import { createServerHandle } from "./smoke-readiness.mjs";

/**
 * Task 027-R2 orchestration tests: the REAL suite and the REAL readiness
 * adapter, driven by fake children, fake fetch, a fake clock and fake node
 * probes. No server is ever spawned; every boot/restart/failure path of the
 * actual call boundary is executed, not inferred from call counts alone.
 */

const fixtures = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

function writeFile(file, content = "x") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

afterEach(() => {
  while (fixtures.length > 0) {
    rmSync(fixtures.pop(), { recursive: true, force: true });
  }
});

/* ───────────────────────────── fake plumbing ──────────────────────────── */

class FakeStream extends EventEmitter {}

/** A child that dies when killed, and can be pre-killed for failure tests. */
function makeFakeChild({ dead = false } = {}) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = dead ? 1 : null;
  child.signalCode = null;
  child.stdout = new FakeStream();
  child.stderr = new FakeStream();
  child.kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return true;
    }
    child.exitCode = 0;
    child.emit("exit", 0, null);
    return true;
  };
  return child;
}

function makeFakeServer(child) {
  return createServerHandle(child);
}

class FakeResponse {
  constructor({ status = 200, headers = {}, json = null, text = "", bytes = null }) {
    this.status = status;
    this.headers = { get: (name) => headers[name.toLowerCase()] ?? null };
    this._json = json;
    this._text = text;
    this._bytes = bytes;
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  async json() {
    return this._json;
  }
  async text() {
    return this._text;
  }
  async arrayBuffer() {
    return this._bytes ? this._bytes.buffer.slice(this._bytes.byteOffset, this._bytes.byteOffset + this._bytes.byteLength) : new ArrayBuffer(0);
  }
}

/** A tiny dev-mode fixture tree (no server ever runs from it). */
function makeDevTargets() {
  const webDir = path.join(makeTempDir("veladesk-smokeweb-"), "apps", "web");
  const standalone = path.join(webDir, ".next", "standalone");
  writeFile(path.join(standalone, "apps", "web", "server.js"), "// server\n");
  writeFile(path.join(standalone, "packages", "database", "drizzle", "meta", "_journal.json"), "[]");
  writeFile(path.join(standalone, "packages", "database", "drizzle", "0000_init.sql"), "-- init\n");
  return { webDir, targets: resolveSmokePaths({ webDir }) };
}

/** A tiny release-package fixture for --runtime mode. */
function makePackageTargets() {
  const packageDir = path.join(makeTempDir("veladesk-smokepkg-"), "VelaDesk-v9.9.9-test-x64");
  const runtime = path.join(packageDir, "runtime");
  writeFile(path.join(runtime, "apps", "web", "server.js"), "// server\n");
  writeFile(path.join(runtime, "packages", "database", "drizzle", "meta", "_journal.json"), "[]");
  writeFile(path.join(runtime, "packages", "database", "drizzle", "0000_init.sql"), "-- init\n");
  writeFile(path.join(runtime, "apps", "web", ".next", "static", "chunk-abc.css"), "body{background:#000}\n");
  // Repo hygiene file FIRST in sorted order: the public-asset picker must
  // skip dot-files and choose the real brand image (run 36871010092).
  writeFile(path.join(runtime, "apps", "web", "public", ".gitkeep"), "");
  writeFile(path.join(runtime, "apps", "web", "public", "brand", "veladesk-logo.png"), "png-bytes");
  writeFile(path.join(runtime, "node_modules", "react", "package.json"), '{"name":"react","version":"19.3.0"}');
  writeFile(path.join(runtime, "node_modules", "react", "index.js"), "module.exports = {}\n");
  writeFile(path.join(runtime, "node_modules", "react-dom", "package.json"), '{"name":"react-dom","version":"19.3.0"}');
  writeFile(path.join(runtime, "node_modules", "better-sqlite3", "better_sqlite3.node"), "\0native\0");
  const launcher = path.join(packageDir, "start-veladesk.sh");
  writeFile(launcher, "#!/bin/sh\nexit 0\n");
  chmodSync(launcher, 0o755);
  return { packageDir, runtime, targets: resolveSmokePaths({ runtimeRoot: packageDir }) };
}

/** The canned API surface: one router covering every URL the suite fetches. */
function makeFakeFetch({ packageFixture, log } = {}) {
  const assetPutCounts = new Map();
  const assetBodies = new Map();
  const defaultPng = new Uint8Array([137, 80, 78, 71]);
  const allIcons = Array.from({ length: 400 }, (_, index) => ({
    id: `fake:icon-${index}`,
    palette: "monochrome",
  }));
  return async (url, init) => {
    const parsed = new URL(url);
    const route = `${parsed.pathname}${parsed.search}`;
    log?.push(route);

    if (parsed.pathname === "/api/v1/workspaces" && (init?.method ?? "GET") === "GET") {
      return new FakeResponse({ headers: { "cache-control": "no-store" }, json: { workspaces: [] } });
    }
    if (parsed.pathname === "/api/v1/workspaces" && init?.method === "POST") {
      return new FakeResponse({ status: 201, json: { workspace: { revision: 1 } } });
    }
    if (parsed.pathname === "/api/v1/workspaces/smoke-workspace") {
      return new FakeResponse({ json: { workspace: { revision: 1 } } });
    }
    if (parsed.pathname === "/api/v1/icons/search") {
      const scope = parsed.searchParams.get("scope") ?? "recommended";
      if (scope === "recommended") {
        return new FakeResponse({
          json: { icons: [{ id: "simple-icons:github", palette: "monochrome" }], nextOffset: null, total: 1 },
        });
      }
      if (scope === "all") {
        const limit = Number(parsed.searchParams.get("limit") ?? 24);
        const offset = Number(parsed.searchParams.get("offset") ?? 0);
        return new FakeResponse({
          json: { icons: allIcons.slice(offset, offset + limit), nextOffset: offset + limit < allIcons.length ? offset + limit : null, total: allIcons.length },
        });
      }
      if (scope === "color") {
        return new FakeResponse({
          json: { icons: allIcons.slice(0, 120).map((icon) => ({ ...icon, palette: "multicolor" })), nextOffset: null, total: 120 },
        });
      }
    }
    const svgMatch = parsed.pathname.match(/^\/api\/v1\/icons\/([^/]+)\/([^/]+)\.svg$/);
    if (svgMatch) {
      const [collection, name] = [svgMatch[1], svgMatch[2]];
      const multicolor = ["fluent-color", "devicon", "vscode-icons", "catppuccin", "noto"].includes(collection);
      const svg = multicolor
        ? `<svg fill="#aabbcc"><path d="${name}"/></svg>`
        : `<svg fill="currentColor"><path d="${name}"/></svg>`;
      return new FakeResponse({
        headers: { "content-type": "image/svg+xml; charset=utf-8" },
        text: svg,
      });
    }
    if (parsed.pathname.startsWith("/api/v1/assets/")) {
      const id = decodeURIComponent(parsed.pathname.slice("/api/v1/assets/".length));
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        const count = (assetPutCounts.get(id) ?? 0) + 1;
        assetPutCounts.set(id, count);
        if (id === "asset-sha256-not-a-real-id") {
          return new FakeResponse({ status: 400 });
        }
        if (id.endsWith("0".repeat(64))) {
          return new FakeResponse({ status: 422 });
        }
        const body = init?.body;
        const oversized = body instanceof Uint8Array && body.byteLength > 4 * 1024 * 1024;
        if (oversized) {
          return new FakeResponse({ status: 413 });
        }
        if (body instanceof Uint8Array) {
          assetBodies.set(id, body);
        }
        if (count === 1) {
          return new FakeResponse({ status: 201, json: { asset: { id, mediaType: "image/png" } } });
        }
        return new FakeResponse({ status: 200, json: { asset: { id, mediaType: "image/png" } } });
      }
      const stored = assetBodies.get(id) ?? defaultPng;
      if (method === "HEAD") {
        return new FakeResponse({ headers: { "content-length": String(stored.byteLength) } });
      }
      return new FakeResponse({
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=31536000, immutable",
          etag: `"${id}"`,
        },
        bytes: stored,
      });
    }
    if (parsed.pathname === "/") {
      return new FakeResponse({ headers: { "content-type": "text/html; charset=utf-8" }, text: "<html><body>veladesk</body></html>" });
    }
    if (parsed.pathname.startsWith("/_next/static/") && packageFixture) {
      const file = path.join(packageFixture.runtime, "apps", "web", ".next", parsed.pathname.slice("/_next/".length));
      const { readFileSync } = await import("node:fs");
      return new FakeResponse({ bytes: new Uint8Array(readFileSync(file)) });
    }
    if (packageFixture && parsed.pathname === "/brand/veladesk-logo.png") {
      const { readFileSync } = await import("node:fs");
      return new FakeResponse({
        bytes: new Uint8Array(readFileSync(path.join(packageFixture.runtime, "apps", "web", "public", "brand", "veladesk-logo.png"))),
      });
    }
    throw new Error(`fake fetch: unhandled route ${route}`);
  };
}

const instantSleep = async () => {};
const fixedNow = () => 1_000_000;
const fakePort = (() => {
  let port = 4100;
  return async () => {
    port += 1;
    return port;
  };
})();

/* ─────────────────────────────── tests ────────────────────────────────── */

describe("resolveSmokePaths (the real path selection)", () => {
  it("derives dev-mode paths from the standalone tree", () => {
    const { targets } = makeDevTargets();
    expect(targets.mode).toBe("dev");
    expect(targets.serverJs.endsWith(path.join("apps", "web", "server.js"))).toBe(true);
    expect(targets.migrationsDir.endsWith(path.join("packages", "database", "drizzle"))).toBe(true);
  });

  it("package mode requires every piece of the release contract — no silent fallback", () => {
    const missingRoot = path.join(makeTempDir("veladesk-missing-"), "pkg");
    expect(() => resolveSmokePaths({ runtimeRoot: missingRoot })).toThrow(/--runtime package incomplete/);
  });

  it("package mode pins the full runtime contract", () => {
    const { targets, packageDir } = makePackageTargets();
    expect(targets.mode).toBe("package");
    expect(targets.packageDir).toBe(packageDir);
    expect(targets.launcherPath).not.toBeNull();
    expect(targets.staticDir.endsWith(path.join(".next", "static"))).toBe(true);
  });

  it("shapes cmd.exe launcher arguments to survive spaced paths (run 36880687846)", () => {
    // cmd /s strips the leading quote and the LAST quote; the launcher path
    // must therefore be double-wrapped so a fully quoted command survives.
    const { args } = windowsLauncherCommand("D:\\a\\_temp\\VelaDesk 归档校验 6\\pkg\\start-veladesk.cmd");
    expect(args).toEqual(["/d", "/s", "/c", '""D:\\a\\_temp\\VelaDesk 归档校验 6\\pkg\\start-veladesk.cmd""']);
    const afterStrip = args[3].slice(1, -1);
    expect(afterStrip.startsWith('"')).toBe(true);
    expect(afterStrip.endsWith('"')).toBe(true);
    expect(afterStrip).toContain(" ");
  });
});

describe("runStandaloneSmoke — the real suite over fake seams", () => {
  it("completes the full dev-mode suite across three boots (initial + two restarts)", async () => {
    const { targets } = makeDevTargets();
    const boots = [];
    const routes = [];

    await runStandaloneSmoke({
      targets,
      startServerImpl: (_targets, boot) => {
        boots.push(boot);
        return makeFakeServer(makeFakeChild());
      },
      fetchImpl: makeFakeFetch({ log: routes }),
      sleepImpl: instantSleep,
      now: fixedNow,
      getFreePortImpl: fakePort,
    });

    expect(boots).toHaveLength(3);
    // The suite actually exercised the API surface it claims to.
    expect(routes.some((route) => route === "/api/v1/workspaces")).toBe(true);
    expect(routes.some((route) => route.startsWith("/api/v1/workspaces/smoke-workspace"))).toBe(true);
    expect(routes.filter((route) => route.startsWith("/api/v1/icons/")).length).toBeGreaterThan(10);
    expect(routes.some((route) => route === "/")).toBe(true);
  });

  it("completes package mode with launcher boots, packaged assets and containment probes", async () => {
    const fixture = makePackageTargets();
    const boots = [];
    const reactEntry = path.join(fixture.runtime, "node_modules", "react", "index.js");
    const nativeEntry = path.join(fixture.runtime, "node_modules", "better-sqlite3", "better_sqlite3.node");
    const probeScripts = [];

    await runStandaloneSmoke({
      targets: fixture.targets,
      launcher: true,
      startServerImpl: (_targets, boot) => {
        boots.push(boot);
        expect(boot.launcher).toBe(true);
        return makeFakeServer(makeFakeChild());
      },
      fetchImpl: makeFakeFetch({ packageFixture: fixture }),
      sleepImpl: instantSleep,
      now: fixedNow,
      getFreePortImpl: fakePort,
      nodeProbeImpl: async (script) => {
        probeScripts.push(script);
        if (script.includes("better-sqlite3")) {
          return nativeEntry;
        }
        return reactEntry;
      },
    });

    expect(boots).toHaveLength(3);
    expect(boots.every((boot) => boot.launcher)).toBe(true);
    // react probed from BOTH contexts + native probe.
    expect(probeScripts.filter((script) => script.includes("'react'"))).toHaveLength(2);
    expect(probeScripts.filter((script) => script.includes("better-sqlite3"))).toHaveLength(1);
  });

  it("rejects --launcher outside package mode", async () => {
    const { targets } = makeDevTargets();
    await expect(
      runStandaloneSmoke({
        targets,
        launcher: true,
        startServerImpl: () => makeFakeServer(makeFakeChild()),
        fetchImpl: makeFakeFetch(),
        sleepImpl: instantSleep,
        now: fixedNow,
        getFreePortImpl: fakePort,
      }),
    ).rejects.toThrow(/--launcher requires --runtime/);
  });

  it("fails fast with the captured stderr when the server exits before readiness", async () => {
    const { targets } = makeDevTargets();
    let error;
    try {
      await runStandaloneSmoke({
        targets,
        startServerImpl: () => {
          const child = makeFakeChild({ dead: true });
          const handle = makeFakeServer(child);
          // The process wrote this before dying; the live collector (attached
          // by makeFakeServer) must surface it in the failure.
          child.stderr.emit("data", "Error: EPERM: operation not permitted, stat 'react'\n");
          return handle;
        },
        fetchImpl: makeFakeFetch(),
        sleepImpl: instantSleep,
        now: fixedNow,
        getFreePortImpl: fakePort,
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("exited before readiness (exitCode: 1");
    // 027-R1 regression guard: the LIVE stderr must be in the failure.
    expect(error.message).toContain("EPERM: operation not permitted");
  });

  it("reports the fetch cause and honors the 30-second deadline on a dead endpoint", async () => {
    const { targets } = makeDevTargets();
    let clock = 1_000_000;
    const now = () => {
      clock += 10_000;
      return clock;
    };
    const failingFetch = async () => {
      const failure = new Error("fetch failed");
      failure.cause = { code: "ECONNREFUSED", errno: "ECONNREFUSED", syscall: "connect", address: "127.0.0.1", port: 4567 };
      throw failure;
    };

    let error;
    try {
      await runStandaloneSmoke({
        targets,
        startServerImpl: () => makeFakeServer(makeFakeChild()),
        fetchImpl: failingFetch,
        sleepImpl: instantSleep,
        now,
        getFreePortImpl: fakePort,
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("did not become ready within 30000ms");
    expect(error.message).toContain("cause.code: ECONNREFUSED");
  });

  it("flags React identity splits across the application and renderer contexts", async () => {
    const fixture = makePackageTargets();
    // A second, duplicate physical react — exactly what the repair must never ship.
    writeFile(path.join(fixture.runtime, "node_modules", "react-copy", "package.json"), '{"name":"react","version":"19.3.0"}');

    let error;
    try {
      await runStandaloneSmoke({
        targets: fixture.targets,
        startServerImpl: () => makeFakeServer(makeFakeChild()),
        fetchImpl: makeFakeFetch({ packageFixture: fixture }),
        sleepImpl: instantSleep,
        now: fixedNow,
        getFreePortImpl: fakePort,
        nodeProbeImpl: async (script) => {
          if (script.includes("better-sqlite3")) {
            return path.join(fixture.runtime, "node_modules", "better-sqlite3", "better_sqlite3.node");
          }
          return path.join(fixture.runtime, "node_modules", "react", "index.js");
        },
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("physical react package");
  });

  it("flags a react that resolves outside the package", async () => {
    const fixture = makePackageTargets();
    const outsideFile = path.join(makeTempDir("veladesk-outside-"), "react.js");
    writeFile(outsideFile, "module.exports = {}\n");

    let error;
    try {
      await runStandaloneSmoke({
        targets: fixture.targets,
        startServerImpl: () => makeFakeServer(makeFakeChild()),
        fetchImpl: makeFakeFetch({ packageFixture: fixture }),
        sleepImpl: instantSleep,
        now: fixedNow,
        getFreePortImpl: fakePort,
        nodeProbeImpl: async (script) => {
          if (script.includes("better-sqlite3")) {
            return path.join(fixture.runtime, "node_modules", "better-sqlite3", "better_sqlite3.node");
          }
          return outsideFile;
        },
      });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("react resolved OUTSIDE the package");
  });
});
