import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createServerLogCollector,
  createServerHandle,
  formatFetchCause,
  pollUntilReady,
  SERVER_LOG_LIMIT_BYTES,
} from "./smoke-readiness.mjs";

/*
 * Task 027-R1 §6 — the readiness seams are unit-tested with FAKE child
 * handles, FAKE fetch, fake clock and fake sleep. No server is ever
 * spawned locally (the local execution restrictions forbid it); the real
 * wiring is exercised on GitHub-hosted runners only.
 */

/** A minimal fake server handle with mutable exit state and log buffers. */
function fakeServer({ exitCode = null, signalCode = null, stdout = "", stderr = "" } = {}) {
  const state = { exitCode, signalCode, stdout, stderr };
  return {
    get exitCode() {
      return state.exitCode;
    },
    get signalCode() {
      return state.signalCode;
    },
    readStdout() {
      return state.stdout;
    },
    readStderr() {
      return state.stderr;
    },
    __state: state,
  };
}

/** fetch double that always throws the given undici-style cause chain. */
function refusedFetch(cause) {
  return async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause });
  };
}

describe("pollUntilReady — early process exit (§3)", () => {
  it("rejects IMMEDIATELY (not at the deadline) with exit code and captured output", async () => {
    const server = fakeServer({ exitCode: 1, stderr: "Error: cannot find module 'better-sqlite3'" });
    let slept = 0;
    const outcome = pollUntilReady({
      url: "http://127.0.0.1:1/api/v1/workspaces",
      deadlineMs: 60_000,
      server,
      fetchImpl: refusedFetch({ code: "ECONNREFUSED", syscall: "connect", address: "127.0.0.1", port: 1 }),
      sleep: async () => {
        slept += 1;
      },
    });
    await expect(outcome).rejects.toThrow(/exited before readiness/);
    await expect(outcome).rejects.toThrow(/exitCode: 1/);
    await expect(outcome).rejects.toThrow(/cannot find module 'better-sqlite3'/);
    // Failed fast: the poll loop never slept once.
    expect(slept).toBe(0);
  });

  it("a signal death reports the signal too", async () => {
    const server = fakeServer({ exitCode: null, signalCode: "SIGKILL" });
    await expect(
      pollUntilReady({
        url: "http://127.0.0.1:1/x",
        deadlineMs: 1000,
        server,
        fetchImpl: refusedFetch({ code: "ECONNREFUSED" }),
        sleep: async () => {},
      }),
    ).rejects.toThrow(/signal: SIGKILL/);
  });
});

describe("pollUntilReady — deadline with a LIVE process (§4/§5)", () => {
  it("times out with the ECONNREFUSED cause, the still-running state and diagnostics", async () => {
    const server = fakeServer({ stderr: "listening soon…" });
    let clock = 0;
    const outcome = pollUntilReady({
      url: "http://127.0.0.1:3999/api/v1/workspaces",
      deadlineMs: 1000,
      server,
      fetchImpl: refusedFetch({ code: "ECONNREFUSED", errno: -4078, syscall: "connect", address: "127.0.0.1", port: 3999 }),
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      pollIntervalMs: 250,
      diagnostics: { serverPath: ".next/standalone/apps/web/server.js" },
    });
    await expect(outcome).rejects.toThrow(/did not become ready within 1000ms/);
    await expect(outcome).rejects.toThrow(/cause\.code: ECONNREFUSED/);
    await expect(outcome).rejects.toThrow(/cause\.errno: -4078/);
    await expect(outcome).rejects.toThrow(/cause\.port: 3999/);
    await expect(outcome).rejects.toThrow(/still running/);
    await expect(outcome).rejects.toThrow(/serverPath: \.next\/standalone\/apps\/web\/server\.js/);
    await expect(outcome).rejects.toThrow(/platform: /);
  });
});

describe("pollUntilReady — success (§6C)", () => {
  it("resolves with the 2xx response once fetch becomes healthy", async () => {
    const server = fakeServer();
    let calls = 0;
    const ok = { ok: true, status: 200 };
    const outcome = await pollUntilReady({
      url: "http://127.0.0.1:2/api/v1/workspaces",
      deadlineMs: 5000,
      server,
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
        }
        return ok;
      },
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 1,
    });
    expect(outcome).toBe(ok);
    expect(calls).toBe(3);
  });
});

describe("the log collector (§2) — the stale-string regression", () => {
  it("readers see output appended AFTER the collector was created", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = { stdout, stderr };
    const collector = createServerLogCollector(child);
    // The old bug snapshotted "" here. Append later — like a real server
    // that only crashes (or logs) well after spawn.
    stderr.emit("data", Buffer.from("late fatal output"));
    stdout.emit("data", Buffer.from("late stdout line\n"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(collector.readStderr()).toContain("late fatal output");
    expect(collector.readStdout()).toContain("late stdout line");
  });

  it("createServerHandle exposes live exit state alongside the readers", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = { stdout, stderr, exitCode: null, signalCode: null };
    const server = createServerHandle(child);
    expect(server.exitCode).toBeNull();
    stderr.emit("data", Buffer.from("dying"));
    child.exitCode = 1; // the process dies mid-poll
    await new Promise((resolve) => setImmediate(resolve));
    expect(server.exitCode).toBe(1);
    expect(server.readStderr()).toContain("dying");
  });

  it("storage stays bounded: older bytes are dropped past the limit", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = { stdout, stderr };
    const collector = createServerLogCollector(child);
    const filler = "x".repeat(SERVER_LOG_LIMIT_BYTES + 1024);
    stderr.emit("data", Buffer.from(filler));
    stderr.emit("data", Buffer.from("NEWEST"));
    const kept = collector.readStderr();
    expect(kept.endsWith("NEWEST")).toBe(true);
    expect(kept).toMatch(/earlier bytes truncated/);
    expect(Buffer.byteLength(kept)).toBeLessThan(SERVER_LOG_LIMIT_BYTES + 4096);
  });
});

describe("formatFetchCause (§4)", () => {
  it("flattens message + cause fields into one line, skipping absent keys", () => {
    const line = formatFetchCause(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED", errno: -4078, syscall: "connect", address: "127.0.0.1", port: 3999 },
      }),
    );
    expect(line).toBe(
      "message: fetch failed, cause.code: ECONNREFUSED, cause.errno: -4078, cause.syscall: connect, cause.address: 127.0.0.1, cause.port: 3999",
    );
  });

  it("a plain error without cause degrades to just its message", () => {
    expect(formatFetchCause(new Error("readiness probe status 500"))).toBe("message: readiness probe status 500");
  });
});

describe("smoke-standalone wiring contract (call-shape guard)", () => {
  const smokeSource = readFileSync(
    fileURLToPath(new URL("./smoke-standalone.mjs", import.meta.url)),
    "utf8",
  );

  it("every readiness poll uses the single-object argument shape with the server handle", () => {
    const calls = smokeSource.match(/pollUntilReady\(/g) ?? [];
    expect(calls.length).toBe(3);
    // The R1 wiring bug was `pollUntilReady(server, {...})` — a two-argument
    // call the single-object signature silently destructures into
    // `server: undefined`. The shape is pinned so it cannot come back.
    expect(smokeSource).not.toMatch(/pollUntilReady\(server,/);
    expect((smokeSource.match(/pollUntilReady\(\{ server, url:/g) ?? []).length).toBe(3);
  });

  it("the readiness deadline stays at 30 seconds on every boot poll (027-R1 §1/§5)", () => {
    expect((smokeSource.match(/deadlineMs: 30_000/g) ?? []).length).toBe(3);
  });

  it("the stale snapshot pattern is gone; teardown keeps receiving the raw child", () => {
    expect(smokeSource).not.toMatch(/serverErrorText\s*=/);
    expect(smokeSource).toMatch(/stopServer\(server\.child\)/);
  });
});
