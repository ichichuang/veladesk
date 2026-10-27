import type { AssetPutResult, AssetRepository } from "../assets/repository";

/**
 * Write-admission contracts shared by the mutating HTTP handlers.
 *
 * The guards are process-level server policy (task vd-guard): they refuse
 * writes that would grow storage without bound. Handlers only read them;
 * the runtime wires the real singletons and tests inject fakes. Read
 * handlers never take a guard, and workspace DELETE deliberately does not
 * either — deleting frees space and must keep working while storage is
 * full.
 */

/**
 * Data-dir budget: while `storageFull` is true, every mutating handler
 * answers 507 `storage-full` before reading the body or touching the
 * repository. The value is cached for the check TTL by the implementation
 * — reading it must stay cheap enough for every request.
 */
export interface WriteGuard {
  readonly storageFull: boolean;
}

/** Why {@link AssetUploadGuard.storeWithinQuota} did not store. */
export type AssetStoreOutcome =
  | { readonly refused: false; readonly put: AssetPutResult }
  | { readonly refused: true };

/**
 * Asset-upload admission in addition to the data-dir budget. Admission
 * and the store itself run as ONE serialized critical section per
 * process, so two concurrent PUTs can never both pass a quota that the
 * first one fills — the quota is a hard per-process cap, not best-effort.
 */
export interface AssetUploadGuard extends WriteGuard {
  /**
   * Admits and stores one upload atomically: the existence probe, the
   * quota decision (running the lazy orphan cleanup once when the first
   * check hits the quota, then re-checking) and the store all happen
   * under the same lock. An already-stored id is a content-addressed
   * idempotent no-op that never consults the quota. `refused: true`
   * (507 `asset-quota-exceeded`) is only ever returned for a NEW asset.
   */
  storeWithinQuota(
    repository: AssetRepository,
    assetId: string,
    bytes: Uint8Array,
  ): Promise<AssetStoreOutcome>;
}
