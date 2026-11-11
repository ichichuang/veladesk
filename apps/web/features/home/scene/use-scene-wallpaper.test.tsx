// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createEmptyWorkspace, DEFAULT_WORKSPACE_APPEARANCE } from "@veladesk/domain";
import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { useSceneWallpaper } from "./use-scene-wallpaper";

vi.mock("../../assets/browser-assets", () => ({ getBrowserAssetRuntime: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("scene asset fallback", () => {
  it.each(["missing", "corrupt"])("falls through %s mode and generic images to the workspace layer (t61)", async (failure) => {
    const loadAsset = vi.fn(async () => failure === "missing"
      ? { ok: false } : { ok: true, blob: new Blob(["image"]) });
    vi.mocked(getBrowserAssetRuntime).mockResolvedValue({ loadAsset } as never);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:corrupt");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.stubGlobal("Image", class { src = ""; decode = async () => { throw new Error("unsupported"); }; });
    const workspace = createEmptyWorkspace({ workspaceId: "w", workspaceName: "W", pageId: "p", pageName: "P", grid: { columns: 4, rows: 4 } });
    const asset = (assetId: string) => ({ kind: "asset" as const, assetId, fit: "cover" as const, position: "center" as const });
    const page = { ...workspace.pages[0]!, wallpaper: asset(`generic-${failure}`), wallpaperByMode: { dark: asset(`dark-${failure}`) } };
    const { result } = renderHook(() => useSceneWallpaper({ sectionNavMachine: { kind: "idle" },
      effectiveActivePageId: "p", renderedPages: [page],
      resolvedAppearance: DEFAULT_WORKSPACE_APPEARANCE, effectiveColorMode: "dark" }));
    await waitFor(() => expect(result.current.effectiveWallpaper.config).toEqual({ kind: "preset", presetId: "chart" }));
    expect(loadAsset.mock.calls).toHaveLength(2);
    expect(page.wallpaperByMode.dark.assetId).toBe(`dark-${failure}`);
    if (failure === "corrupt") expect(revoke).toHaveBeenCalledTimes(2);
  });
});
