import type { WorkspaceSnapshot } from "@veladesk/domain";
import type { AssetRuntime } from "@veladesk/assets/browser";
import type {
  CreateRemoteWorkspaceResult,
  SaveRemoteWorkspaceResult,
  WorkspaceSyncTransport,
} from "@veladesk/sync";

import { collectSnapshotAssetIds } from "./asset-references";

/**
 * Asset-aware workspace sync transport (task 016-B) — the hard ordering
 * rule of the asset pipeline:
 *
 *   every content asset a snapshot references must be REMOTE-READY
 *   before the workspace POST/PUT is sent.
 *
 * The wrapper delegates reads untouched and wraps mutations: a snapshot
 * with zero asset references never even resolves the asset runtime (a
 * workspace without uploads must not pay for — or risk — the asset
 * IndexedDB). With references, each asset is ensured in deterministic
 * order; ANY failure (network, server, missing, hash) aborts the whole
 * workspace mutation. A workspace snapshot is never committed ahead of
 * its bytes.
 */

export interface AssetAwareWorkspaceSyncTransportOptions {
  readonly base: WorkspaceSyncTransport;
  /**
   * Resolves the browser asset runtime lazily — called at most once per
   * mutation and only when the snapshot actually references assets.
   */
  readonly getAssetRuntime: () => Promise<AssetRuntime>;
}

type MutationFailure =
  | { readonly ok: false; readonly reason: "network-error" }
  | { readonly ok: false; readonly reason: "server-error"; readonly status: number }
  | { readonly ok: false; readonly reason: "protocol-error"; readonly status?: number };

/**
 * Maps an asset ensure failure onto the shared workspace transport
 * failure contract. `asset-missing` (referenced nowhere-stored) and every
 * hash/protocol violation are protocol errors; only genuine network and
 * HTTP 5xx outcomes keep their own classes.
 */
function mapAssetFailure(failure: {
  readonly reason: "network-error" | "server-error" | "protocol-error" | "asset-missing";
  readonly status?: number;
}): MutationFailure {
  switch (failure.reason) {
    case "network-error":
      return { ok: false, reason: "network-error" };
    case "server-error":
      return { ok: false, reason: "server-error", status: failure.status ?? 500 };
    case "asset-missing":
    case "protocol-error":
      return { ok: false, reason: "protocol-error", ...(failure.status !== undefined ? { status: failure.status } : {}) };
  }
}

export function createAssetAwareWorkspaceSyncTransport(
  options: AssetAwareWorkspaceSyncTransportOptions
): WorkspaceSyncTransport {
  const { base, getAssetRuntime } = options;

  async function ensureSnapshotAssets(
    snapshot: WorkspaceSnapshot
  ): Promise<MutationFailure | null> {
    const assetIds = collectSnapshotAssetIds(snapshot);
    if (assetIds.length === 0) {
      // Lazy open: no asset references ⇒ no asset database.
      return null;
    }
    const runtime = await getAssetRuntime();
    for (const assetId of assetIds) {
      const ensured = await runtime.ensureRemoteAsset(assetId);
      if (!ensured.ok) {
        return mapAssetFailure(ensured);
      }
    }
    return null;
  }

  return {
    listWorkspaces() {
      return base.listWorkspaces();
    },

    getWorkspace(workspaceId) {
      return base.getWorkspace(workspaceId);
    },

    async createWorkspace(snapshot): Promise<CreateRemoteWorkspaceResult> {
      const failure = await ensureSnapshotAssets(snapshot);
      if (failure !== null) {
        return failure;
      }
      return base.createWorkspace(snapshot);
    },

    async saveWorkspace(snapshot, expectedRevision): Promise<SaveRemoteWorkspaceResult> {
      const failure = await ensureSnapshotAssets(snapshot);
      if (failure !== null) {
        return failure;
      }
      return base.saveWorkspace(snapshot, expectedRevision);
    },
  };
}
