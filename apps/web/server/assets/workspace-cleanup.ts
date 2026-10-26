import { existsSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isContentAssetId } from "@veladesk/assets/core";
import type { VelaDeskDatabase } from "@veladesk/database";

/** Files are quarantined under the SQLite write lock, restored on rollback,
 * and unlinked after commit. Recover a process crash before serving requests. */
export function recoverWorkspaceAssetCleanup(database: VelaDeskDatabase, assetsDir: string): void {
  if (!existsSync(assetsDir)) return;
  database.sqlite.transaction(() => {
    const snapshots = database.sqlite.prepare("SELECT snapshot_json FROM workspaces UNION ALL SELECT snapshot_json FROM workspace_revisions").all() as { snapshot_json: string }[];
    for (const name of readdirSync(assetsDir)) {
      if (!name.startsWith(".workspace-trash-")) continue;
      const assetId = name.slice(name.indexOf("--") + 2, -4);
      if (!isContentAssetId(assetId)) continue;
      const quarantined = path.join(assetsDir, name);
      const original = path.join(assetsDir, `${assetId}.bin`);
      if (snapshots.some(row => row.snapshot_json.includes(JSON.stringify(assetId))) && !existsSync(original)) {
        renameSync(quarantined, original);
      } else {
        try { unlinkSync(quarantined); } catch { /* retry garbage cleanup on next startup */ }
      }
    }
  }).immediate();
}

export function prepareWorkspaceAssetCleanup(assetsDir: string, ids: readonly string[]) {
  const moved: { original: string; quarantined: string }[] = [];
  function rollback() {
    for (const file of moved) if (existsSync(file.quarantined)) renameSync(file.quarantined, file.original);
  }
  try {
    for (const id of ids) {
      if (!isContentAssetId(id)) continue;
      const original = path.join(assetsDir, `${id}.bin`);
      if (!existsSync(original)) continue;
      const quarantined = path.join(assetsDir, `.workspace-trash-${randomUUID()}--${id}.bin`);
      renameSync(original, quarantined);
      moved.push({ original, quarantined });
    }
  } catch (error) {
    rollback();
    throw error;
  }
  return {
    rollback,
    commit() {
      for (const file of moved) {
        // A failed unlink leaves quarantined bytes, never a live orphan or a
        // failed DELETE after the DB committed. Startup recovery retries it.
        try { unlinkSync(file.quarantined); } catch { /* recovered on startup */ }
      }
    },
  };
}
