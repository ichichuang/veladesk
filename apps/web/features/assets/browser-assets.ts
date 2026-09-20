/**
 * Browser-only singleton for the asset runtime (task 016-B).
 *
 * Nothing here may run at module import time: the asset IndexedDB opens
 * lazily on the first explicit call — and the workspace sync wrapper only
 * resolves it when a snapshot actually references an asset icon, so a
 * workspace without uploads never pays for the asset database.
 *
 * A failed open is evicted from the cache again (same rule as the
 * workspace runtime): one transient IndexedDB failure must not poison the
 * whole tab lifecycle.
 *
 * Lab isolation: the workspace lab DB "veladesk-runtime-lab" maps to the
 * asset DB "veladesk-runtime-lab-assets", so labs can never pollute
 * production assets.
 */

import { createAssetRuntime, createHttpAssetTransport, openAssetStore } from "@veladesk/assets/browser";
import type { AssetRuntime } from "@veladesk/assets/browser";

const PRODUCTION_WORKSPACE_DATABASE = "veladesk-local";
const PRODUCTION_ASSET_DATABASE = "veladesk-assets";

/**
 * The asset database name paired with a workspace database name.
 * Production `veladesk-local` → `veladesk-assets`; anything else (labs,
 * tests) → `${name}-assets`.
 */
export function assetDatabaseNameForWorkspaceDatabase(name: string): string {
  return name === PRODUCTION_WORKSPACE_DATABASE ? PRODUCTION_ASSET_DATABASE : `${name}-assets`;
}

const runtimePromises = new Map<string, Promise<AssetRuntime>>();

export function getBrowserAssetRuntime(
  databaseName: string = PRODUCTION_ASSET_DATABASE
): Promise<AssetRuntime> {
  const existing = runtimePromises.get(databaseName);
  if (existing !== undefined) {
    return existing;
  }
  const created = (async () => {
    const store = await openAssetStore({ databaseName });
    const transport = createHttpAssetTransport({ baseUrl: "" });
    return createAssetRuntime({ store, transport });
  })().catch((error: unknown) => {
    runtimePromises.delete(databaseName);
    throw error;
  });
  runtimePromises.set(databaseName, created);
  return created;
}
