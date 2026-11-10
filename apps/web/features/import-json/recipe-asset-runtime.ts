import { getBrowserAssetRuntime } from "../assets/browser-assets";
import type { DecodedRecipeAsset } from "./recipe-assets";

// --- asset-runtime gateway (IndexedDB staging, local probe, remote fetch) -------

/** Stages verified embedded assets; ok=false leaves the import unwritten. */
export async function stageDecodedRecipeAssets(
  assets: readonly DecodedRecipeAsset[]
): Promise<{ readonly ok: true } | { readonly ok: false }> {
  try {
    const runtime = await getBrowserAssetRuntime();
    for (const asset of assets) {
      // stageAsset re-prepares (size + magic + hash) and the derived id must
      // equal the recipe's — a belt-and-braces restatement of the verify.
      const staged = await runtime.stageAsset(asset.blob);
      if (!staged.ok || staged.record.id !== asset.id) {
        return { ok: false };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Local-only availability probe; a runtime failure reports "none local". */
export async function probeLocalRecipeAssetIds(ids: readonly string[]): Promise<ReadonlySet<string>> {
  if (ids.length === 0) {
    return new Set();
  }
  try {
    const runtime = await getBrowserAssetRuntime();
    const local = new Set<string>();
    for (const id of ids) {
      if ((await runtime.getLocalAsset(id)) !== undefined) {
        local.add(id);
      }
    }
    return local;
  } catch {
    return new Set();
  }
}

export interface EnsureRecipeAssetIdsResult {
  /** Ids that resolved — a local hit or a verified remote fetch (now hydrated). */
  readonly available: ReadonlySet<string>;
  /** Ids that did not: no local copy, no remote copy, or the network failed. */
  readonly failed: readonly string[];
}

/**
 * Resolves non-embedded refs at confirm time: the runtime's local-first
 * `loadAsset` (remote GET + re-hash + hydrate on a miss). Failures are
 * EXPECTED outcomes — the caller falls those refs back to the preset.
 */
export async function ensureRecipeAssetIds(ids: readonly string[]): Promise<EnsureRecipeAssetIdsResult> {
  if (ids.length === 0) {
    return { available: new Set(), failed: [] };
  }
  const available = new Set<string>();
  const failed: string[] = [];
  try {
    const runtime = await getBrowserAssetRuntime();
    for (const id of ids) {
      const loaded = await runtime.loadAsset(id);
      if (loaded.ok) {
        available.add(id);
      } else {
        failed.push(id);
      }
    }
  } catch {
    return { available, failed: ids };
  }
  return { available, failed };
}
