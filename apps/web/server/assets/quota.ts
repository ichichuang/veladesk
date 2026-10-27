import { readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { isContentAssetId } from "@veladesk/assets/core";

/**
 * Asset-quota measurement (task vd-guard).
 *
 * Only LIVE assets count: regular `<assetId>.bin` files whose name is a
 * valid content address. `.workspace-trash-*` quarantine files and
 * `.*.tmp-*` in-flight writes are deliberately ignored — they are
 * transient by design (bounded by startup recovery / the atomic rename)
 * and never block uploads for long. Any other foreign file is ignored
 * too; when in doubt nothing is counted against the user.
 */

/** Live-asset usage of an assets dir. */
export interface AssetUsage {
  readonly count: number;
  readonly totalBytes: number;
}

/** The live asset id of a directory entry name, if it is one. */
export function liveAssetId(name: string): string | undefined {
  if (!name.endsWith(".bin")) {
    return undefined;
  }
  const assetId = name.slice(0, -4);
  return isContentAssetId(assetId) ? assetId : undefined;
}

function listEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // missing or unreadable dir reads as empty
  }
}

/**
 * Measures the live-asset usage of `assetsDir`. A missing dir reads as
 * empty; a file that vanishes mid-scan is simply not counted.
 */
export function measureAssetUsage(assetsDir: string): AssetUsage {
  let count = 0;
  let totalBytes = 0;
  for (const entry of listEntries(assetsDir)) {
    if (!entry.isFile()) {
      continue;
    }
    const assetId = liveAssetId(entry.name);
    if (assetId === undefined) {
      continue;
    }
    try {
      totalBytes += statSync(path.join(assetsDir, entry.name)).size;
      count += 1;
    } catch {
      // Deleted between readdir and stat — no longer usage.
    }
  }
  return { count, totalBytes };
}

/**
 * Whether storing one more new asset of `incomingBytes` bytes stays inside
 * the count/size quota (whichever is exceeded first loses).
 */
export function withinAssetQuota(
  usage: AssetUsage,
  incomingBytes: number,
  limits: { readonly maxAssetCount: number; readonly maxAssetTotalBytes: number },
): boolean {
  return (
    usage.count + 1 <= limits.maxAssetCount &&
    usage.totalBytes + incomingBytes <= limits.maxAssetTotalBytes
  );
}
