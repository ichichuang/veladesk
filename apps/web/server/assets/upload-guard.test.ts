import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  createWorkspaceRepository,
  openDatabase,
} from "@veladesk/database";
import type { VelaDeskDatabase } from "@veladesk/database";
import { createContentAssetId } from "@veladesk/assets/core";
import { createEmptyWorkspace } from "@veladesk/domain";

import { handlePutAsset } from "../api/asset-handlers";
import type { AssetUploadGuard } from "../api/write-guard";
import { createDataDirSizeGuard } from "../storage-guard";
import { createFilesystemAssetRepository } from "./repository";
import type { AssetRepository } from "./repository";
import { createAssetUploadGuard } from "./upload-guard";
import { measureAssetUsage, withinAssetQuota } from "./quota";

/**
 * Asset-upload admission (task vd-guard): the count/size quota answers
 * 507 only for NEW assets (idempotent re-PUTs pass), quota pressure runs
 * the orphan cleanup once and re-checks, and the data-dir budget
 * short-circuits everything with 507 storage-full.
 */

const migrationsDir = fileURLToPath(
  new URL("../../../../packages/database/drizzle", import.meta.url),
);

function makePng(seed = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([seed], 16);
  return bytes;
}

function garbageAssetId(seed: string): string {
  return `asset-sha256-${seed.repeat(64).slice(0, 64)}`;
}

interface Harness {
  readonly dataDir: string;
  readonly assetsDir: string;
  readonly database: VelaDeskDatabase;
  readonly repository: AssetRepository;
  readonly clock: { value: number };
  makeGuard(overrides?: Partial<Parameters<typeof createAssetUploadGuard>[0]>): AssetUploadGuard;
  dispose(): void;
}

function harness(): Harness {
  const dataDir = mkdtempSync(path.join(tmpdir(), "upload-guard-"));
  const assetsDir = path.join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  const database = openDatabase({ filename: ":memory:" });
  applyMigrations(database, migrationsDir);
  const repository = createFilesystemAssetRepository({ assetsDir });
  const clock = { value: Date.now() };
  const makeGuard: Harness["makeGuard"] = (overrides) =>
    createAssetUploadGuard({
      database,
      assetsDir,
      storage: createDataDirSizeGuard({ dataDir, maxBytes: 1024 ** 4, ttlMs: 60_000 }),
      maxAssetCount: 200,
      maxAssetTotalBytes: 200 * 1024 * 1024,
      orphanGraceMs: 60_000,
      orphanSweepIntervalMs: 60 * 60 * 1000,
      now: () => clock.value,
      ...overrides,
    });
  return {
    dataDir,
    assetsDir,
    database,
    repository,
    clock,
    makeGuard,
    dispose: () => {
      database.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const item of harnesses.splice(0)) {
    item.dispose();
  }
});

function setup(): Harness {
  const created = harness();
  harnesses.push(created);
  return created;
}

function putRequest(bytes: Uint8Array): Request {
  return new Request("http://localhost:3000/api/v1/assets/x", {
    method: "PUT",
    body: bytes as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
}

async function upload(
  item: Harness,
  bytes: Uint8Array,
  assetId: string,
  guard?: AssetUploadGuard,
): Promise<Response> {
  return handlePutAsset(item.repository, putRequest(bytes), assetId, guard);
}

/** Writes an unreferenced live-named file with a controlled mtime. */
function writeGarbage(item: Harness, seed: string, mtimeMs: number): string {
  const file = path.join(item.assetsDir, `${garbageAssetId(seed)}.bin`);
  writeFileSync(file, "garbage");
  utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

describe("quota measurement helpers", () => {
  it("counts only live content-addressed .bin files", () => {
    const item = setup();
    const id = garbageAssetId("1");
    writeFileSync(path.join(item.assetsDir, `${id}.bin`), "12345");
    writeFileSync(path.join(item.assetsDir, ".workspace-trash-x--" + garbageAssetId("2") + ".bin"), "no");
    writeFileSync(path.join(item.assetsDir, `.${garbageAssetId("3")}.tmp-1-x`), "no");
    writeFileSync(path.join(item.assetsDir, "notes.txt"), "no");

    expect(measureAssetUsage(item.assetsDir)).toEqual({ count: 1, totalBytes: 5 });
  });

  it("reads a missing dir as empty", () => {
    expect(measureAssetUsage(path.join(setup().assetsDir, "missing"))).toEqual({
      count: 0,
      totalBytes: 0,
    });
  });

  it("admits exactly-at-quota uploads and refuses one over", () => {
    const usage = { count: 2, totalBytes: 100 };
    const limits = { maxAssetCount: 3, maxAssetTotalBytes: 200 };
    expect(withinAssetQuota(usage, 100, limits)).toBe(true);
    expect(withinAssetQuota(usage, 101, limits)).toBe(false);
    expect(withinAssetQuota({ count: 2, totalBytes: 0 }, 1, limits)).toBe(true);
    expect(withinAssetQuota({ count: 3, totalBytes: 0 }, 1, limits)).toBe(false);
  });
});

describe("handlePutAsset with the quota guard", () => {
  it("refuses a NEW asset over the count quota with 507 but keeps re-PUTs idempotent", async () => {
    const item = setup();
    const guard = item.makeGuard({ maxAssetCount: 3 });
    const ids: string[] = [];
    for (let seed = 1; seed <= 3; seed += 1) {
      const bytes = makePng(seed);
      const assetId = await createContentAssetId(bytes);
      ids.push(assetId);
      expect((await upload(item, bytes, assetId, guard)).status).toBe(201);
    }

    const fourth = makePng(9);
    const fourthId = await createContentAssetId(fourth);
    const refused = await upload(item, fourth, fourthId, guard);
    expect(refused.status).toBe(507);
    expect(await refused.json()).toEqual({ error: { code: "asset-quota-exceeded" } });
    expect(existsSync(path.join(item.assetsDir, `${fourthId}.bin`))).toBe(false);

    const again = await upload(item, makePng(1), ids[0]!, guard);
    expect(again.status).toBe(200);
  });

  it("refuses a NEW asset over the byte quota with 507", async () => {
    const item = setup();
    const guard = item.makeGuard({ maxAssetTotalBytes: 100 });

    const first = makePng(1);
    expect((await upload(item, first, await createContentAssetId(first), guard)).status).toBe(201);

    const second = makePng(2);
    const secondId = await createContentAssetId(second);
    const refused = await upload(item, second, secondId, guard);
    expect(refused.status).toBe(507);
    expect(await refused.json()).toEqual({ error: { code: "asset-quota-exceeded" } });
  });

  it("serializes concurrent admissions: at cap 1, of two concurrent PUTs exactly one wins", async () => {
    const item = setup();
    const guard = item.makeGuard({ maxAssetCount: 1 });

    const first = makePng(1);
    const second = makePng(2);
    const [a, b] = await Promise.all([
      upload(item, first, await createContentAssetId(first), guard),
      upload(item, second, await createContentAssetId(second), guard),
    ]);

    // Whichever admission wins the lock stores the file; the loser sees
    // the just-filled quota. The cap can never be overshot by racing.
    expect([a.status, b.status].sort()).toEqual([201, 507]);
    expect(measureAssetUsage(item.assetsDir).count).toBe(1);
  });

  it("runs the orphan cleanup once on quota pressure and admits the upload afterwards", async () => {
    const item = setup();
    const guard = item.makeGuard({ maxAssetCount: 3 });
    const garbage = [
      writeGarbage(item, "7", item.clock.value - 120_000),
      writeGarbage(item, "8", item.clock.value - 120_000),
    ];
    const first = makePng(1);
    expect((await upload(item, first, await createContentAssetId(first), guard)).status).toBe(201);
    expect(measureAssetUsage(item.assetsDir).count).toBe(3);

    const second = makePng(2);
    const response = await upload(item, second, await createContentAssetId(second), guard);

    expect(response.status).toBe(201);
    expect(garbage.every((file) => !existsSync(file))).toBe(true);
    expect(measureAssetUsage(item.assetsDir).count).toBe(2);
  });

  it("never deletes a fresh unreferenced file to satisfy the quota", async () => {
    const item = setup();
    const guard = item.makeGuard({ maxAssetCount: 2 });
    const freshGarbage = writeGarbage(item, "9", item.clock.value + 1_000);
    const first = makePng(1);
    expect((await upload(item, first, await createContentAssetId(first), guard)).status).toBe(201);

    const second = makePng(2);
    const secondId = await createContentAssetId(second);
    const refused = await upload(item, second, secondId, guard);

    expect(refused.status).toBe(507);
    expect(existsSync(freshGarbage)).toBe(true);
    expect(existsSync(path.join(item.assetsDir, `${secondId}.bin`))).toBe(false);
  });

  it("keeps referenced files while cleaning up under quota pressure", async () => {
    const item = setup();
    const guard = item.makeGuard({ maxAssetCount: 2 });
    const referencedBytes = makePng(1);
    const referencedId = await createContentAssetId(referencedBytes);
    expect((await upload(item, referencedBytes, referencedId, guard)).status).toBe(201);
    const repository = createWorkspaceRepository(item.database, { now: () => item.clock.value });
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    });
    repository.createWorkspace({
      ...workspace,
      pages: workspace.pages.map((page) => ({
        ...page,
        wallpaper: { kind: "asset", assetId: referencedId, fit: "cover", position: "center" },
      })),
    });
    // Age the referenced file past the grace period: only its reference
    // (not its freshness) may protect it from the pressure sweep.
    const referencedFile = path.join(item.assetsDir, `${referencedId}.bin`);
    utimesSync(referencedFile, new Date(item.clock.value - 120_000), new Date(item.clock.value - 120_000));

    const oldGarbage = writeGarbage(item, "a", item.clock.value - 120_000);
    const second = makePng(2);
    const response = await upload(item, second, await createContentAssetId(second), guard);

    expect(response.status).toBe(201);
    expect(existsSync(oldGarbage)).toBe(false);
    expect(existsSync(referencedFile)).toBe(true);
  });

  it("sweeps opportunistically at most once per interval on upload", async () => {
    const item = setup();
    const guard = item.makeGuard({ maxAssetCount: 10 });
    const referencedBytes = makePng(1);
    const referencedId = await createContentAssetId(referencedBytes);
    expect((await upload(item, referencedBytes, referencedId, guard)).status).toBe(201);
    const repository = createWorkspaceRepository(item.database, { now: () => item.clock.value });
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    });
    repository.createWorkspace({
      ...workspace,
      pages: workspace.pages.map((page) => ({
        ...page,
        wallpaper: { kind: "asset", assetId: referencedId, fit: "cover", position: "center" },
      })),
    });

    const garbage = writeGarbage(item, "b", item.clock.value - 120_000);
    item.clock.value += 1_000;
    const soon = makePng(2);
    expect((await upload(item, soon, await createContentAssetId(soon), guard)).status).toBe(201);
    expect(existsSync(garbage)).toBe(true); // interval not elapsed: no sweep

    item.clock.value += 60 * 60 * 1000;
    const later = makePng(3);
    expect((await upload(item, later, await createContentAssetId(later), guard)).status).toBe(201);
    expect(existsSync(garbage)).toBe(false); // interval elapsed: swept
    expect(existsSync(path.join(item.assetsDir, `${referencedId}.bin`))).toBe(true);
  });

  it("answers 507 storage-full before anything else when the data dir is over budget", async () => {
    const item = setup();
    writeFileSync(path.join(item.dataDir, "blob.bin"), "x".repeat(200));
    const guard = item.makeGuard({
      storage: createDataDirSizeGuard({
        dataDir: item.dataDir,
        maxBytes: 100,
        ttlMs: 60_000,
        now: () => item.clock.value,
      }),
    });

    const bytes = makePng(1);
    const assetId = await createContentAssetId(bytes);
    const response = await upload(item, bytes, assetId, guard);

    expect(response.status).toBe(507);
    expect(await response.json()).toEqual({ error: { code: "storage-full" } });
    expect(existsSync(path.join(item.assetsDir, `${assetId}.bin`))).toBe(false);
  });
});
