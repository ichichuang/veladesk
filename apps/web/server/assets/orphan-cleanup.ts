import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { VelaDeskDatabase } from "@veladesk/database";

import { liveAssetId } from "./quota";

/**
 * Orphaned-asset cleanup (task vd-guard).
 *
 * Deletes `<assetId>.bin` files that NO row of `workspaces` or
 * `workspace_revisions` references (the same `snapshot_json` contains
 * `JSON.stringify(assetId)` check as the workspace delete cleanup), and
 * only when the file's mtime is older than the adoption grace period —
 * the client uploads an image BEFORE saving the snapshot that references
 * it, so fresh unreferenced files are always presumed to be mid-adoption
 * and never deleted.
 *
 * References are read and files deleted inside one SQLite IMMEDIATE
 * transaction, so a concurrent save either committed its reference before
 * our read (asset kept) or waits on our write lock (its reference lands
 * only after our decision — which the grace period then protects). When
 * in doubt the file is kept: stat failures, foreign names and unlink
 * failures all leave the file alone.
 */

export interface OrphanCleanupResult {
  /** Asset ids whose files were deleted. */
  readonly deletedAssetIds: readonly string[];
}

export interface OrphanCleanupOptions {
  readonly database: VelaDeskDatabase;
  readonly assetsDir: string;
  readonly graceMs: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}

export function cleanupOrphanedAssets(options: OrphanCleanupOptions): OrphanCleanupResult {
  const clock = options.now ?? Date.now;
  if (!existsSync(options.assetsDir)) {
    return { deletedAssetIds: [] };
  }
  const deleted: string[] = [];
  options.database.sqlite.transaction(() => {
    // Same reference read as recoverWorkspaceAssetCleanup: current rows
    // plus every (still retained) historical revision row.
    const snapshots = options.database.sqlite
      .prepare("SELECT snapshot_json FROM workspaces UNION ALL SELECT snapshot_json FROM workspace_revisions")
      .all() as { snapshot_json: string }[];
    const cutoff = clock() - options.graceMs;
    for (const entry of readdirSync(options.assetsDir, { withFileTypes: true })) {
      // Quarantine and temp files never pass liveAssetId, and deleted
      // workspace assets in quarantine are startup recovery's job.
      const assetId = entry.isFile() ? liveAssetId(entry.name) : undefined;
      if (assetId === undefined) {
        continue;
      }
      const file = path.join(options.assetsDir, entry.name);
      let mtimeMs: number;
      try {
        mtimeMs = statSync(file).mtimeMs;
      } catch {
        continue; // vanished — nothing to delete
      }
      if (mtimeMs >= cutoff) {
        continue; // inside the adoption grace period: keep
      }
      const needle = JSON.stringify(assetId);
      if (snapshots.some((row) => row.snapshot_json.includes(needle))) {
        continue; // referenced by current or historical state: keep
      }
      try {
        unlinkSync(file);
        deleted.push(assetId);
      } catch {
        // Unremovable now — retry on the next sweep; keeping is safe.
      }
    }
  }).immediate();
  return { deletedAssetIds: deleted };
}
