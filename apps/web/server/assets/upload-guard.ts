import type { VelaDeskDatabase } from "@veladesk/database";

import type { AssetStoreOutcome, AssetUploadGuard } from "../api/write-guard";
import type { DataDirSizeGuard } from "../storage-guard";
import type { AssetRepository } from "./repository";
import { cleanupOrphanedAssets } from "./orphan-cleanup";
import { measureAssetUsage, withinAssetQuota } from "./quota";

/**
 * Asset-upload admission (task vd-guard): the data-dir budget plus the
 * assets-dir count/size quota, with lazy orphan cleanup.
 *
 * Admission is exact per process, not best-effort: the existence probe,
 * the quota decision and the store run inside one serialized critical
 * section (a promise-chain mutex — the server is a single Node process),
 * so concurrent uploads of different new assets are admitted strictly one
 * after the other and can never jointly overshoot the cap.
 *
 * When a new upload would hit the quota, the orphan cleanup runs once and
 * the quota is re-checked — `refused` is only returned when the dir is
 * still over budget afterwards (507 `asset-quota-exceeded`). An
 * opportunistic sweep also runs at most once per sweep interval, so
 * unreferenced files are eventually reclaimed even while the quota is not
 * yet full.
 */
export interface AssetUploadGuardOptions {
  readonly database: VelaDeskDatabase;
  readonly assetsDir: string;
  readonly storage: DataDirSizeGuard;
  readonly maxAssetCount: number;
  readonly maxAssetTotalBytes: number;
  readonly orphanGraceMs: number;
  readonly orphanSweepIntervalMs: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}

export function createAssetUploadGuard(options: AssetUploadGuardOptions): AssetUploadGuard {
  const clock = options.now ?? Date.now;
  // The first opportunistic sweep waits one full interval from creation;
  // quota pressure always sweeps immediately, lazily.
  let lastSweepAt = clock();
  let tail: Promise<unknown> = Promise.resolve();

  function sweep(): void {
    cleanupOrphanedAssets({
      database: options.database,
      assetsDir: options.assetsDir,
      graceMs: options.orphanGraceMs,
      now: clock,
    });
    lastSweepAt = clock();
  }

  /** Quota decision for a NEW asset, with the one lazy cleanup + re-check. */
  function admitsNewAsset(byteLength: number): boolean {
    let usage = measureAssetUsage(options.assetsDir);
    if (!withinAssetQuota(usage, byteLength, options)) {
      sweep();
      usage = measureAssetUsage(options.assetsDir);
      if (!withinAssetQuota(usage, byteLength, options)) {
        return false;
      }
    }
    return true;
  }

  return {
    get storageFull(): boolean {
      return options.storage.storageFull;
    },
    async storeWithinQuota(
      repository: AssetRepository,
      assetId: string,
      bytes: Uint8Array,
    ): Promise<AssetStoreOutcome> {
      // Promise-chain mutex: every admission+store critical section runs
      // after the previous one settled (rejections included), so the
      // chain never breaks mid-queue.
      const operation = tail.then(async (): Promise<AssetStoreOutcome> => {
        const existing = await repository.head(assetId);
        if (existing.exists) {
          // Idempotent re-PUT: content-addressed no-op, never quota-checked.
          return { refused: false, put: await repository.put(assetId, bytes) };
        }
        if (clock() - lastSweepAt >= options.orphanSweepIntervalMs) {
          sweep();
        }
        if (!admitsNewAsset(bytes.byteLength)) {
          return { refused: true };
        }
        return { refused: false, put: await repository.put(assetId, bytes) };
      });
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
}
