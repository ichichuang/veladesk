import { describe, expect, it } from "vitest";
import { createContentAssetId, MAX_ASSET_BYTES } from "@veladesk/assets/core";
import { exportRecipe, replacePageModeWallpaper } from "@veladesk/domain";
import { VELADESK_VERSION } from "../../lib/app-version";
import { addSection, baseWorkspace, makeTestIdFactory, officeWorkspace } from "./fixtures";
import { prepareWorkspaceRecipe } from "./recipe-file";
import { decodeRecipeAssets } from "./recipe-assets";
import { parseImportDocument } from "./parser";
import { planImport } from "./planner";
import { applyImportPlan } from "./apply-import";
import { IMPORT_MAX_FILE_BYTES } from "./contract";

const createdAt = "2026-11-10T00:00:00.000Z";
const decodeDimensions = async () => ({ width: 100, height: 100 });
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
async function fixture() {
  const id = await createContentAssetId(bytes);
  let workspace = baseWorkspace();
  for (const mode of ["light", "dark"] as const) {
    const result = replacePageModeWallpaper(workspace, workspace.pages[0]!.id, mode, {
      kind: "asset", assetId: id, fit: "cover", position: "center",
    });
    if (!result.ok) throw new Error("fixture");
    workspace = result.workspace;
  }
  return { workspace, id };
}

describe("recipe wallpaper export", () => {
  it("OFF preserves the existing fixture bytes and never reads assets", async () => {
    const workspace = officeWorkspace().workspace;
    const file = await prepareWorkspaceRecipe(workspace, { createdAt, getLocalAsset: async () => { throw new Error("must not read"); } });
    expect(file.text).toBe(JSON.stringify(exportRecipe(workspace, { createdAt, appMinVersion: VELADESK_VERSION }), null, 2));
    expect(JSON.parse(file.text).assets).toBeUndefined();
  });
  it("deduplicates light/dark refs and round trips through D1 parse, decode and apply", async () => {
    const { workspace, id } = await fixture();
    const file = await prepareWorkspaceRecipe(workspace, { embedWallpapers: true, decodeDimensions,
      getLocalAsset: async () => ({ blob: new Blob([bytes]), mediaType: "image/png" }) });
    expect(Object.keys(JSON.parse(file.text).assets)).toEqual([id]);
    const parsed = parseImportDocument(file.text, { maxLength: IMPORT_MAX_FILE_BYTES });
    if (!parsed.ok) throw new Error("parse");
    const decoded = await decodeRecipeAssets(JSON.parse(file.text).assets, { decodeDimensions });
    if (!decoded.ok) throw new Error("decode");
    const target = { ...baseWorkspace(), pages: baseWorkspace().pages.map((page) => ({ ...page, name: "Target" })) };
    const plan = planImport(target, parsed.parsed.document, parsed.parsed.issues);
    const applied = applyImportPlan(target, plan, makeTestIdFactory(), {
      recipe: parsed.parsed.recipe, availableAssetIds: new Set(decoded.assets.map((asset) => asset.id)),
    });
    if (!applied.ok) throw new Error("apply");
    const landed = applied.workspace.pages.find((page) => page.name === "Home");
    expect(landed?.wallpaperByMode?.light).toMatchObject({ kind: "asset", assetId: id });
    expect(landed?.wallpaperByMode?.dark).toMatchObject({ kind: "asset", assetId: id });
    expect(file.byteLength).toBe(new Blob([file.text]).size);
    expect(file.skipped).toEqual([]);
  });
  it.each([9, 5])("enforces count/file budgets for %i distinct images", async (count) => {
    let workspace = baseWorkspace();
    const locals = new Map<string, { blob: Blob; mediaType: "image/png" }>();
    for (let index = 0; index < count; index++) {
      const payload = new Uint8Array(count === 5 ? MAX_ASSET_BYTES : bytes.length);
      payload.set(bytes);
      payload[payload.length - 1] = index;
      const id = await createContentAssetId(payload);
      locals.set(id, { blob: new Blob([payload]), mediaType: "image/png" });
      workspace = addSection(workspace, `space-${index}`, `Space ${index}`);
      const result = replacePageModeWallpaper(workspace, `space-${index}`, "dark", {
        kind: "asset", assetId: id, fit: "cover", position: "center",
      });
      if (!result.ok) throw new Error("fixture");
      workspace = result.workspace;
    }
    const file = await prepareWorkspaceRecipe(workspace, { embedWallpapers: true, decodeDimensions,
      getLocalAsset: async (id) => locals.get(id) });
    expect(Object.keys(JSON.parse(file.text).assets)).toHaveLength(count === 9 ? 8 : 4);
    expect(file.skipped).toEqual([expect.objectContaining({ reason: count === 9 ? "asset-count-limit" : "file-size-limit" })]);
    expect(file.byteLength).toBeLessThanOrEqual(IMPORT_MAX_FILE_BYTES);
    expect(parseImportDocument(file.text, { maxLength: IMPORT_MAX_FILE_BYTES }).ok).toBe(true);
  });
  it.each(["missing", "oversize", "bad-hash", "dimensions"])("keeps references when %s cannot embed", async (kind) => {
    const { workspace, id } = await fixture();
    const file = await prepareWorkspaceRecipe(workspace, { embedWallpapers: true,
      decodeDimensions: async () => ({ width: kind === "dimensions" ? 8193 : 100, height: 100 }),
      getLocalAsset: async () => kind === "missing" ? undefined : ({ mediaType: "image/png",
        blob: new Blob([kind === "oversize" ? new Uint8Array(MAX_ASSET_BYTES + 1) : kind === "bad-hash" ? new Uint8Array([...bytes, 2]) : bytes]) }),
    });
    expect(JSON.parse(file.text).assets).toBeUndefined();
    expect(file.text).toContain(`asset:${id}`);
    expect(file.skipped).toHaveLength(1);
    expect(parseImportDocument(file.text).ok).toBe(true);
  });
});
