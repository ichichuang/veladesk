/**
 * Browser-only factory for the workspace client runtime.
 *
 * Nothing here may run at module import time: no IndexedDB open, no fetch,
 * no initialize. The runtime is created lazily on the first explicit call
 * (from a client effect) and cached as a singleton per database name.
 *
 * A failed open is removed from the cache again: one transient IndexedDB
 * failure must not poison the whole tab lifecycle. Retry stays an explicit
 * caller decision (reload) — there is no automatic retry here.
 *
 * The production default is the "veladesk-local" database. Engineering
 * labs pass their own database name (e.g. "veladesk-runtime-lab") so they
 * can never pollute the homepage data.
 *
 * Since task 016-B the transport is composed MANUALLY: local store → HTTP
 * workspace transport → asset-aware wrapper → client runtime. The wrapper
 * guarantees every referenced asset is remote-ready before any workspace
 * POST/PUT, so the client runtime's startup dirty sync is asset-first too
 * — without the coordinator itself ever learning about assets.
 */

import { openLocalWorkspaceStore } from "@veladesk/local-store";
import { createHttpWorkspaceSyncTransport } from "@veladesk/sync";
import { createWorkspaceClientRuntime } from "@veladesk/client-runtime";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { getBrowserAssetRuntime, assetDatabaseNameForWorkspaceDatabase } from "../assets/browser-assets";
import { createAssetAwareWorkspaceSyncTransport } from "./asset-aware-workspace-transport";

const DEFAULT_DATABASE_NAME = "veladesk-local";

const runtimePromises = new Map<string, Promise<WorkspaceClientRuntime>>();

export function getBrowserWorkspaceRuntime(
  databaseName: string = DEFAULT_DATABASE_NAME
): Promise<WorkspaceClientRuntime> {
  const existing = runtimePromises.get(databaseName);
  if (existing !== undefined) {
    return existing;
  }
  const created = (async () => {
    const store = await openLocalWorkspaceStore({ databaseName });
    const baseTransport = createHttpWorkspaceSyncTransport({ baseUrl: "" });
    const transport = createAssetAwareWorkspaceSyncTransport({
      base: baseTransport,
      getAssetRuntime: () => getBrowserAssetRuntime(assetDatabaseNameForWorkspaceDatabase(databaseName)),
    });
    return createWorkspaceClientRuntime({ store, transport });
  })().catch((error: unknown) => {
    runtimePromises.delete(databaseName);
    throw error;
  });
  runtimePromises.set(databaseName, created);
  return created;
}
