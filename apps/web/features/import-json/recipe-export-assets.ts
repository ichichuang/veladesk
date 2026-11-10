import { exportRecipe, RECIPE_MAX_ASSETS } from "@veladesk/domain";
import type { WorkspaceSnapshot, RecipeAssetV1 } from "@veladesk/domain";
import { VELADESK_VERSION } from "../../lib/app-version";

import { MAX_ASSET_BYTES } from "@veladesk/assets/core";
import { getBrowserAssetRuntime } from "../assets/browser-assets";
import { collectRecipeAssetRefs, decodeRecipeAssets } from "./recipe-assets";
import type { DecodeRecipeAssetsOptions } from "./recipe-assets";
import { IMPORT_MAX_FILE_BYTES } from "./contract";

export interface PreparedRecipeExport {
  readonly text: string;
  readonly byteLength: number;
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
}

export interface RecipeExportOptions extends DecodeRecipeAssetsOptions {
  readonly embedWallpapers?: boolean;
  readonly createdAt?: string;
  readonly getLocalAsset?: (id: string) => Promise<{ readonly blob: Blob; readonly mediaType: RecipeAssetV1["mediaType"] } | undefined>;
}

/** Prepare once so the displayed size is the exact UTF-8 download size. */
export async function prepareWorkspaceRecipe(
  workspace: WorkspaceSnapshot,
  options: RecipeExportOptions = {},
): Promise<PreparedRecipeExport> {
  const recipe = exportRecipe(workspace, {
    createdAt: options.createdAt ?? new Date().toISOString(),
    appMinVersion: VELADESK_VERSION,
  });
  const assets: Record<string, RecipeAssetV1> = {};
  const serialize = () => JSON.stringify(Object.keys(assets).length ? { ...recipe, assets } : recipe, null, 2);
  const size = (text: string) => new Blob([text]).size;
  const skipped: { id: string; reason: string }[] = [];
  if (options.embedWallpapers) {
    const getLocal = options.getLocalAsset ?? (async (id: string) =>
      (await getBrowserAssetRuntime()).getLocalAsset(id));
    for (const id of collectRecipeAssetRefs(recipe)) {
      try {
        if (Object.keys(assets).length >= RECIPE_MAX_ASSETS) {
          skipped.push({ id, reason: "asset-count-limit" });
          continue;
        }
        const local = await getLocal(id);
        if (!local) {
          skipped.push({ id, reason: "missing-local-asset" });
          continue;
        }
        if (local.blob.size > MAX_ASSET_BYTES) {
          skipped.push({ id, reason: "asset-too-large" });
          continue;
        }
        const bytes = new Uint8Array(await local.blob.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        }
        const entry = { mediaType: local.mediaType, data: btoa(binary) };
        const verified = await decodeRecipeAssets({ [id]: entry }, options);
        if (!verified.ok) {
          skipped.push({ id, reason: verified.issue.reason });
          continue;
        }
        assets[id] = entry;
        if (size(serialize()) > IMPORT_MAX_FILE_BYTES) {
          delete assets[id];
          skipped.push({ id, reason: "file-size-limit" });
        }
      } catch {
        skipped.push({ id, reason: "local-asset-unavailable" });
      }
    }
  }
  const text = serialize();
  const byteLength = size(text);
  if (byteLength > IMPORT_MAX_FILE_BYTES) throw new Error("recipe-file-too-large");
  return { text, byteLength, skipped };
}

