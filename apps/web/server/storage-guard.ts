import { readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

/**
 * Data-dir size guard (task vd-guard).
 *
 * While the whole data dir (SQLite file + -wal/-shm sidecars + the assets
 * tree, recursively) exceeds its byte budget, every mutating endpoint
 * answers 507 `storage-full`; GET/HEAD and workspace DELETE (which frees
 * space) stay unaffected.
 *
 * The recursive measurement is cached for the check TTL so requests never
 * pay a full directory walk — reads of `storageFull` are one clock read
 * plus, at most once per TTL, one bounded scan of the data dir.
 */

/** The write-admission view of the data-dir budget. */
export interface DataDirSizeGuard {
  /** True while the measured data-dir size exceeds the budget. */
  readonly storageFull: boolean;
}

export interface DataDirSizeGuardOptions {
  readonly dataDir: string;
  readonly maxBytes: number;
  readonly ttlMs: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}

function listEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // missing or unreadable dir reads as empty
  }
}

/**
 * Recursive byte size of every regular file under `dir`. Symlinks are
 * neither followed nor counted (no cycles, no double counting); a missing
 * or unreadable dir reads as 0.
 */
export function measureDirectoryBytes(dir: string): number {
  let total = 0;
  for (const entry of listEntries(dir)) {
    if (entry.isDirectory()) {
      total += measureDirectoryBytes(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      try {
        total += statSync(path.join(dir, entry.name)).size;
      } catch {
        // Vanished mid-scan — nothing to count.
      }
    }
  }
  return total;
}

export function createDataDirSizeGuard(options: DataDirSizeGuardOptions): DataDirSizeGuard {
  const clock = options.now ?? Date.now;
  let cachedAt = Number.NEGATIVE_INFINITY;
  let cachedFull = false;
  return {
    get storageFull(): boolean {
      const at = clock();
      if (at - cachedAt < options.ttlMs) {
        return cachedFull;
      }
      cachedFull = measureDirectoryBytes(options.dataDir) > options.maxBytes;
      cachedAt = at;
      return cachedFull;
    },
  };
}
