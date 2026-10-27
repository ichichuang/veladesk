import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  createWorkspaceRepository,
  openDatabase,
} from "@veladesk/database";
import type { VelaDeskDatabase } from "@veladesk/database";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { cleanupOrphanedAssets } from "./orphan-cleanup";

/**
 * Orphan cleanup (task vd-guard): only files referenced by NO current or
 * historical snapshot row are deleted, and only when their mtime is older
 * than the adoption grace period. When in doubt the file is kept.
 */

const migrationsDir = fileURLToPath(
  new URL("../../../../packages/database/drizzle", import.meta.url),
);

const directories: string[] = [];
const databases: VelaDeskDatabase[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function assetsDir(): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "orphan-cleanup-")), "assets");
  mkdirSync(dir, { recursive: true });
  directories.push(path.dirname(dir));
  return dir;
}

function database(): VelaDeskDatabase {
  const created = openDatabase({ filename: ":memory:" });
  applyMigrations(created, migrationsDir);
  databases.push(created);
  return created;
}

function assetId(seed: string): string {
  return `asset-sha256-${seed.repeat(64).slice(0, 64)}`;
}

function writeAsset(dir: string, id: string, mtimeMs: number, bytes = "bytes"): string {
  const file = path.join(dir, `${id}.bin`);
  writeFileSync(file, bytes);
  utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

/** A snapshot whose first page wallpaper references the given asset. */
function snapshotReferencing(asset: string): WorkspaceSnapshot {
  const workspace = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });
  return {
    ...workspace,
    pages: workspace.pages.map((page) => ({
      ...page,
      wallpaper: { kind: "asset", assetId: asset, fit: "cover", position: "center" },
    })),
  };
}

describe("cleanupOrphanedAssets", () => {
  it("deletes an old unreferenced file and keeps referenced and fresh ones", () => {
    const dir = assetsDir();
    const db = database();
    const now = 1_700_000_000_000;
    const grace = 24 * 60 * 60 * 1000;
    const referenced = assetId("1");
    const fresh = assetId("2");
    const orphan = assetId("3");

    const repository = createWorkspaceRepository(db, { now: () => now });
    repository.createWorkspace(snapshotReferencing(referenced));
    writeAsset(dir, referenced, now - 2 * grace);
    writeAsset(dir, fresh, now - 1_000);
    writeAsset(dir, orphan, now - 2 * grace);

    const result = cleanupOrphanedAssets({ database: db, assetsDir: dir, graceMs: grace, now: () => now });

    expect(result.deletedAssetIds).toEqual([orphan]);
    expect(existsSync(path.join(dir, `${referenced}.bin`))).toBe(true);
    expect(existsSync(path.join(dir, `${fresh}.bin`))).toBe(true);
    expect(existsSync(path.join(dir, `${orphan}.bin`))).toBe(false);
  });

  it("keeps an asset referenced only by a historical revision row", () => {
    const dir = assetsDir();
    const db = database();
    const now = 1_700_000_000_000;
    const grace = 1_000;
    const onlyInHistory = assetId("4");

    const repository = createWorkspaceRepository(db, { now: () => now });
    const workspace = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    });
    repository.createWorkspace(workspace);
    // Revision 2 references the asset; the current row (revision 3) no
    // longer does. History is still restorable data.
    repository.saveWorkspace(snapshotReferencing(onlyInHistory), 1);
    repository.saveWorkspace(workspace, 2);
    writeAsset(dir, onlyInHistory, now - 10 * grace);

    const result = cleanupOrphanedAssets({ database: db, assetsDir: dir, graceMs: grace, now: () => now });

    expect(result.deletedAssetIds).toEqual([]);
    expect(existsSync(path.join(dir, `${onlyInHistory}.bin`))).toBe(true);
  });

  it("keeps a file whose mtime is just inside the grace boundary", () => {
    const dir = assetsDir();
    const db = database();
    const now = 1_700_000_000_000;
    const grace = 60_000;
    const justInside = assetId("5");
    writeAsset(dir, justInside, now - grace + 1_000);

    const result = cleanupOrphanedAssets({ database: db, assetsDir: dir, graceMs: grace, now: () => now });

    expect(result.deletedAssetIds).toEqual([]);
    expect(existsSync(path.join(dir, `${justInside}.bin`))).toBe(true);
  });

  it("never touches quarantine, temp or foreign files", () => {
    const dir = assetsDir();
    const db = database();
    const now = 1_700_000_000_000;
    const grace = 1_000;
    const id = assetId("6");
    const files = [
      path.join(dir, `.workspace-trash-11111111-2222-3333-4444-555555555555--${id}.bin`),
      path.join(dir, `.${id}.tmp-1234-abcd`),
      path.join(dir, "notes.txt"),
    ];
    for (const file of files) {
      writeFileSync(file, "keep me");
      utimesSync(file, new Date(now - 10 * grace), new Date(now - 10 * grace));
    }

    const result = cleanupOrphanedAssets({ database: db, assetsDir: dir, graceMs: grace, now: () => now });

    expect(result.deletedAssetIds).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(files.map((file) => path.basename(file)).sort());
  });

  it("is a no-op for a missing assets dir", () => {
    const db = database();

    const result = cleanupOrphanedAssets({
      database: db,
      assetsDir: path.join(assetsDir(), "does-not-exist"),
      graceMs: 1_000,
    });

    expect(result.deletedAssetIds).toEqual([]);
  });
});
