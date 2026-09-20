/**
 * Public API of @veladesk/assets/browser.
 *
 * Browser-only: the Dexie asset store, the HTTP asset transport and the
 * local-first runtime. Never imported by the server.
 */

export { ASSET_STORE_SCHEMA_VERSION, VelaDeskAssetDatabase } from "./store-database";

export { openAssetStore } from "./store";
export type { OpenAssetStoreOptions } from "./store";

export { createHttpAssetTransport } from "./transport";
export type { HttpAssetTransportOptions } from "./transport";

export { createAssetRuntime } from "./runtime";
export type { CreateAssetRuntimeOptions } from "./runtime";

export type {
  AcknowledgeAssetResult,
  AssetOutboxEntry,
  AssetRuntime,
  AssetRuntimeFailure,
  AssetStore,
  AssetSyncState,
  AssetTransport,
  FlushOutboxResult,
  GetAssetResult,
  HeadAssetResult,
  HydrateAssetResult,
  LocalAssetRecord,
  PutAssetResult,
  RuntimeEnsureAssetResult,
  RuntimeLoadAssetResult,
  RuntimeStageAssetResult,
  RuntimeSyncAssetResult,
  StageAssetRecordResult,
} from "./types";
