import type { DexieOptions } from "dexie";

import { prepareAssetBlob } from "../core";
import type { ContentAssetId } from "../core";

import { VelaDeskAssetDatabase } from "./store-database";
import type {
  AcknowledgeAssetResult,
  AssetOutboxEntry,
  AssetStore,
  HydrateAssetResult,
  LocalAssetRecord,
  StageAssetRecordResult,
} from "./types";

/**
 * AssetStore implementation over Dexie/IndexedDB.
 *
 * The browser's durable working set of uploaded assets: content-addressed
 * blob records plus a coalesced one-entry-per-asset outbox of pending
 * uploads. Every multi-record write (stage/ack/hydrate) runs in a single
 * Dexie transaction so records and outbox can never disagree.
 */

const DEFAULT_DATABASE_NAME = "veladesk-assets";

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

class AssetStoreImpl implements AssetStore {
  constructor(
    private readonly db: VelaDeskAssetDatabase,
    private readonly now: () => number
  ) {}

  getAsset(assetId: ContentAssetId): Promise<LocalAssetRecord | undefined> {
    return this.db.assets.get(assetId);
  }

  async stageAsset(prepared: {
    readonly id: ContentAssetId;
    readonly blob: Blob;
    readonly mediaType: LocalAssetRecord["mediaType"];
    readonly byteLength: number;
  }): Promise<StageAssetRecordResult> {
    const existing = await this.db.assets.get(prepared.id);
    if (existing !== undefined && existing.syncState === "clean") {
      // Already ACKed by the server: content-addressed identity means this
      // is the same asset — no re-queue, no blob rewrite.
      return { ok: true, status: "clean", record: existing };
    }
    if (existing !== undefined) {
      // Already pending: identical content by construction (same id). Keep
      // the stored blob AND the original outbox queuedAt — re-uploads of
      // the same asset never reorder the outbox.
      await this.db.transaction("rw", this.db.assets, this.db.assetOutbox, async () => {
        const outboxEntry = await this.db.assetOutbox.get(prepared.id);
        if (outboxEntry === undefined) {
          await this.db.assetOutbox.put({ assetId: prepared.id, queuedAt: this.now() });
        }
      });
      return { ok: true, status: "pending", record: existing };
    }

    const record: LocalAssetRecord = {
      id: prepared.id,
      blob: prepared.blob,
      mediaType: prepared.mediaType,
      byteLength: prepared.byteLength,
      createdAt: this.now(),
      syncState: "pending",
    };
    const queuedAt = this.now();
    await this.db.transaction(
      "rw",
      this.db.assets,
      this.db.assetOutbox,
      async () => {
        await this.db.assets.put(record);
        await this.db.assetOutbox.put({ assetId: prepared.id, queuedAt });
      }
    );
    return { ok: true, status: "staged", record };
  }

  async listAssetOutbox(): Promise<readonly AssetOutboxEntry[]> {
    const entries = await this.db.assetOutbox.toArray();
    return [...entries].sort(
      (a, b) => a.queuedAt - b.queuedAt || compareStrings(a.assetId, b.assetId)
    );
  }

  async acknowledgeUpload(assetId: ContentAssetId): Promise<AcknowledgeAssetResult> {
    return this.db.transaction("rw", this.db.assets, this.db.assetOutbox, async () => {
      const existing = await this.db.assets.get(assetId);
      if (existing === undefined) {
        // Invariant: the server ACKed an asset we never staged. Never
        // silently create — surface the inconsistency.
        return { ok: false as const, reason: "asset-missing" as const };
      }
      const record: LocalAssetRecord = { ...existing, syncState: "clean" };
      await this.db.assets.put(record);
      await this.db.assetOutbox.delete(assetId);
      return { ok: true as const, record };
    });
  }

  async hydrateRemoteAsset(
    assetId: ContentAssetId,
    blob: Blob
  ): Promise<HydrateAssetResult> {
    // Remote bytes are protocol data, not truth: re-detect and re-hash
    // before anything is persisted.
    const prepared = await prepareAssetBlob(blob);
    if (!prepared.ok) {
      return {
        ok: false,
        reason: prepared.reason === "unsupported-image-type" ? "unsupported-image-type" : "asset-id-mismatch",
      };
    }
    if (prepared.asset.id !== assetId) {
      return { ok: false, reason: "asset-id-mismatch" };
    }
    const record: LocalAssetRecord = {
      id: assetId,
      blob: prepared.asset.blob,
      mediaType: prepared.asset.mediaType,
      byteLength: prepared.asset.byteLength,
      createdAt: this.now(),
      syncState: "clean",
    };
    await this.db.transaction("rw", this.db.assets, this.db.assetOutbox, async () => {
      await this.db.assets.put(record);
      // A clean record needs no outbox entry — upload work is done.
      await this.db.assetOutbox.delete(assetId);
    });
    return { ok: true, record };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export interface OpenAssetStoreOptions {
  /** IndexedDB database name. Defaults to "veladesk-assets". */
  readonly databaseName?: string;

  /** Injectable clock. */
  readonly now?: () => number;

  /** IndexedDB implementation injection (tests / non-window contexts). */
  readonly indexedDB?: IDBFactory;
  readonly IDBKeyRange?: typeof IDBKeyRange;
}

/**
 * Opens the browser asset store. Awaited explicitly so IndexedDB open
 * failures surface immediately at a call site that can react to them —
 * never at module import time.
 */
export async function openAssetStore(options: OpenAssetStoreOptions = {}): Promise<AssetStore> {
  // Dexie's injected-implementation option types are looser than DOM lib —
  // same pattern as @veladesk/local-store.
  const dexieOptions: DexieOptions | undefined =
    options.indexedDB !== undefined
      ? ({ indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange } as DexieOptions)
      : undefined;
  const db = new VelaDeskAssetDatabase(
    options.databaseName ?? DEFAULT_DATABASE_NAME,
    dexieOptions
  );
  await db.open();
  return new AssetStoreImpl(db, options.now ?? Date.now);
}
