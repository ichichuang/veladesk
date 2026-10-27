import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDataDirSizeGuard, measureDirectoryBytes } from "./storage-guard";

/**
 * Data-dir size guard (task vd-guard): the recursive measurement covers
 * the SQLite file, its -wal/-shm sidecars and the assets tree, and the
 * cached decision only refreshes after the TTL — no scan per request.
 */

const directories: string[] = [];

function dataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storage-guard-"));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("measureDirectoryBytes", () => {
  it("sums every regular file recursively across the data dir", () => {
    const dir = dataDir();
    writeFileSync(path.join(dir, "veladesk.db"), "0123456789"); // 10
    writeFileSync(path.join(dir, "veladesk.db-wal"), "0123456789"); // 10
    mkdirSync(path.join(dir, "assets"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "asset-sha256-x.bin"), "01"); // 2
    mkdirSync(path.join(dir, "assets", "empty-nested"), { recursive: true });

    expect(measureDirectoryBytes(dir)).toBe(22);
  });

  it("reads a missing directory as 0", () => {
    expect(measureDirectoryBytes(path.join(dataDir(), "missing"))).toBe(0);
  });
});

describe("createDataDirSizeGuard", () => {
  it("is not full at or below the budget and full one byte over", () => {
    const dir = dataDir();
    const clock = { value: 1_000 };
    const guard = createDataDirSizeGuard({ dataDir: dir, maxBytes: 100, ttlMs: 5_000, now: () => clock.value });

    expect(guard.storageFull).toBe(false); // empty dir, measured

    writeFileSync(path.join(dir, "exact.bin"), "x".repeat(100));
    clock.value += 5_000;
    expect(guard.storageFull).toBe(false); // exactly at budget: not over

    writeFileSync(path.join(dir, "one-more.bin"), "x");
    clock.value += 5_000;
    expect(guard.storageFull).toBe(true); // one byte over
  });

  it("caches the decision for the TTL instead of rescanning per request", () => {
    const dir = dataDir();
    const clock = { value: 1_000 };
    const guard = createDataDirSizeGuard({ dataDir: dir, maxBytes: 100, ttlMs: 5_000, now: () => clock.value });

    expect(guard.storageFull).toBe(false);
    const bigFile = path.join(dir, "big.bin");
    writeFileSync(bigFile, "x".repeat(200));
    expect(guard.storageFull).toBe(false); // cached decision

    clock.value += 4_999;
    expect(guard.storageFull).toBe(false); // still inside the TTL

    clock.value += 1;
    expect(guard.storageFull).toBe(true); // TTL expired: remeasured

    rmSync(bigFile);
    expect(guard.storageFull).toBe(true); // cached again

    clock.value += 5_000;
    expect(guard.storageFull).toBe(false); // freed space is visible after the TTL
  });

  it("blocks writes once the WAL sidecar pushes the dir over budget", () => {
    const dir = dataDir();
    const clock = { value: 1_000 };
    const guard = createDataDirSizeGuard({ dataDir: dir, maxBytes: 30, ttlMs: 5_000, now: () => clock.value });

    writeFileSync(path.join(dir, "veladesk.db"), "x".repeat(20));
    expect(guard.storageFull).toBe(false);
    writeFileSync(path.join(dir, "veladesk.db-wal"), "x".repeat(20));
    clock.value += 5_000; // past the TTL: remeasure with the sidecar present
    expect(guard.storageFull).toBe(true); // db + wal sidecar counted together
  });
});
