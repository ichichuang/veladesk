/**
 * Browser-side contracts of the asset pipeline (task 016-B).
 *
 * These live next to the implementation modules; the server never imports
 * this entry point.
 */

import type { ContentAssetId, UploadedAssetMediaType } from "../core";

/** Sync state of a local asset record. */
export type AssetSyncState = "pending" | "clean";

/** One durable local asset: the blob plus its content identity. */
export interface LocalAssetRecord {
  readonly id: ContentAssetId;
  readonly blob: Blob;
  readonly mediaType: UploadedAssetMediaType;
  readonly byteLength: number;
  readonly createdAt: number;
  readonly syncState: AssetSyncState;
}

/** One pending upload, unique per asset. */
export interface AssetOutboxEntry {
  readonly assetId: ContentAssetId;
  readonly queuedAt: number;
}

/**
 * Result of {@link AssetStore.stageAsset}. The input is already prepared
 * (validated + hashed by the core), so staging itself cannot fail.
 */
export type StageAssetRecordResult = {
  readonly ok: true;
  /** staged = new pending record; pending = kept existing pending; clean = already synced. */
  readonly status: "staged" | "pending" | "clean";
  readonly record: LocalAssetRecord;
};

/** Result of {@link AssetStore.acknowledgeUpload}. */
export type AcknowledgeAssetResult =
  | {
      readonly ok: true;
      readonly record: LocalAssetRecord;
    }
  | {
      readonly ok: false;
      /** The asset is not in the local store — never silently created. */
      readonly reason: "asset-missing";
    };

/** Result of {@link AssetStore.hydrateRemoteAsset}. */
export type HydrateAssetResult =
  | {
      readonly ok: true;
      readonly record: LocalAssetRecord;
    }
  | {
      readonly ok: false;
      readonly reason: "asset-id-mismatch" | "unsupported-image-type";
    };

/**
 * Durable browser-side asset storage: content-addressed records plus a
 * one-entry-per-asset upload outbox. Multi-record writes run in a single
 * Dexie transaction so records and outbox can never disagree.
 */
export interface AssetStore {
  getAsset(assetId: ContentAssetId): Promise<LocalAssetRecord | undefined>;

  /**
   * Stages a prepared asset: missing → insert pending + outbox; already
   * pending → keep the stored blob and the original queuedAt; already
   * clean → no-op. Equal content bytes always hit the same id.
   */
  stageAsset(prepared: {
    readonly id: ContentAssetId;
    readonly blob: Blob;
    readonly mediaType: UploadedAssetMediaType;
    readonly byteLength: number;
  }): Promise<StageAssetRecordResult>;

  /** Pending uploads in deterministic order: queuedAt ASC, then assetId ASC. */
  listAssetOutbox(): Promise<readonly AssetOutboxEntry[]>;

  /**
   * Marks a locally pending asset clean after a server ACK and removes its
   * outbox entry. A missing record is an invariant failure, never a silent
   * create.
   */
  acknowledgeUpload(assetId: ContentAssetId): Promise<AcknowledgeAssetResult>;

  /**
   * Stores verified remote bytes as a clean record and clears any outbox
   * entry. The bytes are re-detected and re-hashed; a hash that does not
   * equal the id is a protocol failure, never data.
   */
  hydrateRemoteAsset(
    assetId: ContentAssetId,
    blob: Blob
  ): Promise<HydrateAssetResult>;

  close(): Promise<void>;
}

/** Result of {@link AssetTransport.putAsset}. */
export type PutAssetResult =
  | {
      readonly ok: true;
      /** stored = 201 new; existed = 200 idempotent replay. */
      readonly status: "stored" | "existed";
      readonly asset: {
        readonly id: ContentAssetId;
        readonly mediaType: UploadedAssetMediaType;
        readonly byteLength: number;
      };
    }
  | {
      readonly ok: false;
      readonly reason: "network-error";
    }
  | {
      readonly ok: false;
      readonly reason: "server-error";
      readonly status: number;
    }
  | {
      readonly ok: false;
      readonly reason: "protocol-error";
      readonly status?: number;
    };

/** Result of {@link AssetTransport.getAsset}. */
export type GetAssetResult =
  | {
      readonly ok: true;
      readonly blob: Blob;
      readonly mediaType: UploadedAssetMediaType;
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | {
      readonly ok: false;
      readonly reason: "network-error";
    }
  | {
      readonly ok: false;
      readonly reason: "server-error";
      readonly status: number;
    }
  | {
      readonly ok: false;
      readonly reason: "protocol-error";
      readonly status?: number;
    };

/** Result of {@link AssetTransport.headAsset}. */
export type HeadAssetResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | {
      readonly ok: false;
      readonly reason: "network-error";
    }
  | {
      readonly ok: false;
      readonly reason: "server-error";
      readonly status: number;
    }
  | {
      readonly ok: false;
      readonly reason: "protocol-error";
      readonly status?: number;
    };

/** Browser HTTP boundary towards the self-hosted asset API. */
export interface AssetTransport {
  putAsset(record: {
    readonly id: ContentAssetId;
    readonly blob: Blob;
    readonly mediaType: UploadedAssetMediaType;
    readonly byteLength: number;
  }): Promise<PutAssetResult>;

  getAsset(assetId: ContentAssetId): Promise<GetAssetResult>;

  headAsset(assetId: ContentAssetId): Promise<HeadAssetResult>;
}

/** Shared runtime failure contract (maps onto the workspace sync contract). */
export type AssetRuntimeFailure =
  | {
      readonly ok: false;
      readonly reason: "network-error";
    }
  | {
      readonly ok: false;
      readonly reason: "server-error";
      readonly status: number;
    }
  | {
      readonly ok: false;
      readonly reason: "protocol-error";
      readonly status?: number;
    };

export type RuntimeSyncAssetResult =
  | {
      readonly ok: true;
      readonly status: "synced" | "clean";
    }
  | {
      readonly ok: false;
      readonly reason: "asset-missing";
    }
  | AssetRuntimeFailure;

export type RuntimeLoadAssetResult =
  | {
      readonly ok: true;
      readonly blob: Blob;
      readonly mediaType: UploadedAssetMediaType;
      readonly source: "local" | "remote";
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | AssetRuntimeFailure;

export type RuntimeEnsureAssetResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly reason: "asset-missing";
    }
  | AssetRuntimeFailure;

/**
 * Result of {@link AssetRuntime.stageAsset}: core prepare failures
 * (empty/too-large/unsupported) surface BEFORE anything touches
 * IndexedDB, so the editor can show the right validation message.
 */
export type RuntimeStageAssetResult =
  | {
      readonly ok: true;
      readonly status: "staged" | "pending" | "clean";
      readonly record: LocalAssetRecord;
    }
  | {
      readonly ok: false;
      readonly reason: "asset-empty" | "asset-too-large" | "unsupported-image-type";
    };

export type FlushOutboxResult = readonly {
  readonly assetId: ContentAssetId;
  readonly result: RuntimeSyncAssetResult;
}[];

/** Local-first asset runtime over a store + transport pair. */
export interface AssetRuntime {
  stageAsset(blob: Blob): Promise<RuntimeStageAssetResult>;

  getLocalAsset(assetId: ContentAssetId): Promise<LocalAssetRecord | undefined>;

  /** Local blob first, zero network on a hit; remote GET + hydrate on a miss. */
  loadAsset(assetId: ContentAssetId): Promise<RuntimeLoadAssetResult>;

  /** One PUT attempt for a pending asset; failures keep it pending. */
  syncAsset(assetId: ContentAssetId): Promise<RuntimeSyncAssetResult>;

  /** One-pass flush of the outbox snapshot at flush start. */
  flushOutbox(): Promise<FlushOutboxResult>;

  /**
   * Guarantees the server holds this asset before a workspace mutation:
   * pending → sync, clean → success, missing → HEAD probe.
   */
  ensureRemoteAsset(assetId: ContentAssetId): Promise<RuntimeEnsureAssetResult>;

  close(): Promise<void>;
}
