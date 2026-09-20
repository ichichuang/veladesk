import Dexie from "dexie";
import type { DexieOptions, Table } from "dexie";

import type { AssetOutboxEntry, LocalAssetRecord } from "./types";

/**
 * Dexie database wrapper of the browser asset store.
 *
 * A dedicated IndexedDB database ("veladesk-assets" in production) — the
 * existing `veladesk-local` workspace store schema is never touched.
 */

/** IndexedDB schema version of the asset store. Independent of everything else. */
export const ASSET_STORE_SCHEMA_VERSION = 1;

/** Typed Dexie database holding local assets and the upload outbox. */
export class VelaDeskAssetDatabase extends Dexie {
  readonly assets!: Table<LocalAssetRecord, string>;

  readonly assetOutbox!: Table<AssetOutboxEntry, string>;

  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    this.version(ASSET_STORE_SCHEMA_VERSION).stores({
      assets: "&id, syncState, createdAt",
      assetOutbox: "&assetId, queuedAt",
    });
  }
}
