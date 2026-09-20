import { prepareAssetBlob } from "../core";
import type { ContentAssetId } from "../core";

import type {
  AssetRuntime,
  AssetStore,
  AssetTransport,
  FlushOutboxResult,
  RuntimeEnsureAssetResult,
  RuntimeLoadAssetResult,
  RuntimeStageAssetResult,
  RuntimeSyncAssetResult,
} from "./types";

/**
 * Local-first asset runtime: store + transport + explicit sync.
 *
 * The runtime is the ONLY component the UI talks to. It never blocks a
 * local stage on the network and never retries by itself — flushing and
 * recovery are explicit caller decisions, mirroring the workspace sync
 * model.
 *
 * Same-process singleflight: concurrent `syncAsset` calls for one asset
 * share a single PUT, and concurrent `loadAsset` misses share a single
 * GET. The in-flight maps are cleared in `finally`.
 */

export interface CreateAssetRuntimeOptions {
  readonly store: AssetStore;
  readonly transport: AssetTransport;
}

class AssetRuntimeImpl implements AssetRuntime {
  private readonly syncInFlight = new Map<ContentAssetId, Promise<RuntimeSyncAssetResult>>();
  private readonly loadInFlight = new Map<ContentAssetId, Promise<RuntimeLoadAssetResult>>();

  constructor(
    private readonly store: AssetStore,
    private readonly transport: AssetTransport
  ) {}

  async stageAsset(blob: Blob): Promise<RuntimeStageAssetResult> {
    // Validate + hash BEFORE anything is persisted: an unsupported or
    // oversized upload never touches IndexedDB.
    const prepared = await prepareAssetBlob(blob);
    if (!prepared.ok) {
      return { ok: false, reason: prepared.reason };
    }
    return this.store.stageAsset(prepared.asset);
  }

  async getLocalAsset(assetId: ContentAssetId) {
    return this.store.getAsset(assetId);
  }

  async loadAsset(assetId: ContentAssetId): Promise<RuntimeLoadAssetResult> {
    const existing = await this.store.getAsset(assetId);
    if (existing !== undefined) {
      // Local-first: zero network on a hit, even while offline.
      return { ok: true, blob: existing.blob, mediaType: existing.mediaType, source: "local" };
    }
    const inFlight = this.loadInFlight.get(assetId);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const load = this.loadRemote(assetId).finally(() => {
      this.loadInFlight.delete(assetId);
    });
    this.loadInFlight.set(assetId, load);
    return load;
  }

  private async loadRemote(assetId: ContentAssetId): Promise<RuntimeLoadAssetResult> {
    const fetched = await this.transport.getAsset(assetId);
    if (!fetched.ok) {
      if (fetched.reason === "protocol-error") {
        return {
          ok: false,
          reason: "protocol-error",
          ...(fetched.status !== undefined ? { status: fetched.status } : {}),
        };
      }
      return fetched;
    }
    const hydrated = await this.store.hydrateRemoteAsset(assetId, fetched.blob);
    if (!hydrated.ok) {
      return { ok: false, reason: "protocol-error" };
    }
    return {
      ok: true,
      blob: hydrated.record.blob,
      mediaType: hydrated.record.mediaType,
      source: "remote",
    };
  }

  async syncAsset(assetId: ContentAssetId): Promise<RuntimeSyncAssetResult> {
    const inFlight = this.syncInFlight.get(assetId);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const sync = this.syncOne(assetId).finally(() => {
      this.syncInFlight.delete(assetId);
    });
    this.syncInFlight.set(assetId, sync);
    return sync;
  }

  private async syncOne(assetId: ContentAssetId): Promise<RuntimeSyncAssetResult> {
    const record = await this.store.getAsset(assetId);
    if (record === undefined) {
      // Invariant: syncing an asset we never staged.
      return { ok: false, reason: "asset-missing" };
    }
    if (record.syncState === "clean") {
      return { ok: true, status: "clean" };
    }
    const put = await this.transport.putAsset({
      id: record.id,
      blob: record.blob,
      mediaType: record.mediaType,
      byteLength: record.byteLength,
    });
    if (!put.ok) {
      // The pending record (and its outbox entry) survive every failure.
      return put;
    }
    const ack = await this.store.acknowledgeUpload(assetId);
    if (!ack.ok) {
      return { ok: false, reason: "asset-missing" };
    }
    return { ok: true, status: "synced" };
  }

  async flushOutbox(): Promise<FlushOutboxResult> {
    // One pass over the SNAPSHOT taken at flush start — work queued while
    // flushing waits for the next flush, exactly like the workspace outbox.
    const entries = await this.store.listAssetOutbox();
    const results: { assetId: ContentAssetId; result: RuntimeSyncAssetResult }[] = [];
    for (const entry of entries) {
      results.push({ assetId: entry.assetId, result: await this.syncAsset(entry.assetId) });
    }
    return results;
  }

  async ensureRemoteAsset(assetId: ContentAssetId): Promise<RuntimeEnsureAssetResult> {
    const record = await this.store.getAsset(assetId);
    if (record !== undefined) {
      if (record.syncState === "clean") {
        // clean ⇒ the server has ACKed this exact content before.
        return { ok: true };
      }
      const synced = await this.syncAsset(assetId);
      return synced.ok ? { ok: true } : synced;
    }
    const head = await this.transport.headAsset(assetId);
    if (head.ok) {
      return { ok: true };
    }
    if (head.reason === "not-found") {
      // Referenced by a workspace but stored nowhere — the workspace
      // mutation must be blocked, never committed half-backed.
      return { ok: false, reason: "asset-missing" };
    }
    if (head.reason === "protocol-error") {
      return {
        ok: false,
        reason: "protocol-error",
        ...(head.status !== undefined ? { status: head.status } : {}),
      };
    }
    return head;
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}

export function createAssetRuntime(options: CreateAssetRuntimeOptions): AssetRuntime {
  return new AssetRuntimeImpl(options.store, options.transport);
}
