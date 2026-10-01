// @vitest-environment jsdom
/*
 * Task 023-C web-layer tests: the wallpaper upload policy (mocked asset
 * core + controllable decode seam), the shared background surface/layers
 * (preset/image/cold rendering, same-node no-op, crossfade), and the
 * Settings background editor's scope/draft/preview/save contracts through
 * the real SettingsCenter. jsdom proves DOM/style state and call
 * contracts — never painted pixels or measured layout.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";

import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { SettingsCenter } from "./settings-center";
import type { SettingsSaveResult } from "./settings-center";
import type { WorkspaceSettingsDraft } from "./settings-draft";
import {
  WorkspaceWallpaperLayers,
  WallpaperSurface,
  useWallpaperAssetUrl,
  type BackgroundPreview,
} from "./desktop-wallpaper";
import {
  prepareWallpaperImage,
  WALLPAPER_MAX_AREA,
  WALLPAPER_MAX_DIMENSION,
} from "./wallpaper-prep";
import { gsap } from "@components/vd/gsap";
import type { PreparedAsset } from "@veladesk/assets/core";

vi.mock("@veladesk/assets/core", () => ({
  prepareAssetBlob: vi.fn(),
  MAX_ASSET_BYTES: 4 * 1024 * 1024,
}));

// Deterministic decode seam (the browser's real gate).
const decodeResult = { bitmap: { width: 1920, height: 1080, close: () => {} } };
const createImageBitmapMock = vi.fn(async () => decodeResult.bitmap);

function threePageWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-1",
    workspaceName: "W",
    pageId: "page-1",
    pageName: "Alpha",
    grid: { columns: 3, rows: 3 },
  });
  const pages: DesktopPage[] = (["page-1", "page-2", "page-3"] as const).map((id) => ({
    ...base.pages[0]!,
    id,
    name: id === "page-1" ? "Alpha" : id === "page-2" ? "Beta" : "Gamma",
    layout: { ...base.pages[0]!.layout, id },
  }));
  return { ...base, pages };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = createImageBitmapMock;
});

afterEach(() => {
  cleanup();
  gsap.globalTimeline.clear();
  vi.clearAllMocks();
  window.localStorage.clear();
});

function fakeAsset(id = "asset-sha256-abc"): PreparedAsset {
  return { id, blob: new Blob(["x"], { type: "image/png" }), mediaType: "image/png", byteLength: 1 };
}

describe("wallpaper upload policy (023-C.3)", () => {
  it("accepts a genuinely decodable image and creates ONLY a candidate + preview URL", async () => {
    const { prepareAssetBlob } = await import("@veladesk/assets/core");
    const urlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.mocked(prepareAssetBlob).mockResolvedValue({ ok: true, asset: fakeAsset() });
    const result = await prepareWallpaperImage(new Blob(["img"]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.image.previewUrl).toBe("blob:preview");
      expect(result.image.asset.id).toBe("asset-sha256-abc");
    }
    urlSpy.mockRestore();
  });

  it("the core pipeline's refusal (empty/too-large/unsupported) propagates — no decode attempted", async () => {
    const { prepareAssetBlob } = await import("@veladesk/assets/core");
    for (const reason of ["asset-empty", "asset-too-large", "unsupported-image-type"] as const) {
      vi.mocked(prepareAssetBlob).mockResolvedValue({ ok: false, reason });
      const result = await prepareWallpaperImage(new Blob(["x"]));
      expect(result).toEqual({ ok: false, issue: reason });
    }
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it("a failed real decode is refused", async () => {
    const { prepareAssetBlob } = await import("@veladesk/assets/core");
    vi.mocked(prepareAssetBlob).mockResolvedValue({ ok: true, asset: fakeAsset() });
    createImageBitmapMock.mockRejectedValueOnce(new Error("corrupt"));
    const result = await prepareWallpaperImage(new Blob(["x"]));
    expect(result).toEqual({ ok: false, issue: "decode-failed" });
  });

  it("oversized dimensions or decoded area are refused by the wallpaper policy", async () => {
    const { prepareAssetBlob } = await import("@veladesk/assets/core");
    vi.mocked(prepareAssetBlob).mockResolvedValue({ ok: true, asset: fakeAsset() });
    createImageBitmapMock.mockResolvedValueOnce({
      width: WALLPAPER_MAX_DIMENSION + 1,
      height: 100,
      close: () => {},
    });
    expect(await prepareWallpaperImage(new Blob(["x"]))).toEqual({
      ok: false,
      issue: "dimensions-too-large",
    });
    createImageBitmapMock.mockResolvedValueOnce({
      width: 8000,
      height: Math.ceil(WALLPAPER_MAX_AREA / 8000) + 1000,
      close: () => {},
    });
    expect(await prepareWallpaperImage(new Blob(["x"]))).toEqual({
      ok: false,
      issue: "dimensions-too-large",
    });
  });
});

describe("the shared background surface (023-C.2/§C.4)", () => {
  const presetWallpaper = {
    config: { kind: "preset", presetId: "mist" },
    provenance: "workspace",
  } as const;

  it("renders presets through the same definition the desktop uses", () => {
    const { container } = render(<WallpaperSurface wallpaper={presetWallpaper} assetUrl={null} />);
    const surface = container.querySelector(".vela-wallpaper-surface--preset");
    expect(surface?.getAttribute("data-wallpaper-preset")).toBe("mist");
  });

  it("renders a resolved image with its fit; a cold asset keeps the neutral canvas", () => {
    const assetWallpaper = {
      config: { kind: "asset", assetId: "asset-x", fit: "contain", position: "center" },
      provenance: "section",
    } as const;
    const cold = render(<WallpaperSurface wallpaper={assetWallpaper} assetUrl={null} />);
    expect(cold.container.querySelector("[data-wallpaper-image='asset-x']")).not.toBeNull();
    expect(cold.container.querySelector("img")).toBeNull();

    const warm = render(<WallpaperSurface wallpaper={assetWallpaper} assetUrl="blob:img" />);
    const img = warm.container.querySelector("img[data-wallpaper-image='asset-x']");
    expect(img?.getAttribute("src")).toBe("blob:img");
    expect(warm.container.querySelector(".vela-wallpaper-surface--image")?.getAttribute("data-wallpaper-fit")).toBe("contain");
  });

  it("the desktop layers keep the same node for an unchanged config and crossfade on change", async () => {
    function Host({ presetId }: { readonly presetId: "mist" | "dawn" }) {
      return (
        <WorkspaceWallpaperLayers
          wallpaper={{ config: { kind: "preset", presetId }, provenance: "workspace" }}
          assetUrl={null}
        />
      );
    }
    const { rerender, container } = render(<Host presetId="mist" />);
    const incoming = container.querySelector(".vela-desktop__wallpaper-incoming");
    expect(incoming).not.toBeNull();

    // Unrelated rerender with the SAME config: no tween, no second surface.
    rerender(<Host presetId="mist" />);
    expect(gsap.getTweensOf(incoming!)).toHaveLength(0);
    expect(container.querySelectorAll(".vela-wallpaper-surface--preset")).toHaveLength(1);

    // A different config: ONE crossfade tween; the settled surface stays
    // underneath until the fade completes, then retires.
    rerender(<Host presetId="dawn" />);
    expect(container.querySelectorAll(".vela-wallpaper-surface--preset")).toHaveLength(2);
    const tweens = gsap.getTweensOf(container.querySelector(".vela-desktop__wallpaper-incoming")!);
    expect(tweens).toHaveLength(1);
    await act(async () => {
      tweens[0]!.progress(1);
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".vela-wallpaper-surface--preset")).toHaveLength(1),
    );
    expect(
      container.querySelector(".vela-wallpaper-surface--preset")?.getAttribute("data-wallpaper-preset"),
    ).toBe("dawn");
  });

  it("a late asset result applies only to the still-current request", async () => {
    let release: ((url: string | null) => void) | undefined;
    const loader = vi.fn(
      (assetId: string) =>
        new Promise<{ ok: boolean; url: string | null }>((resolve) => {
          void assetId;
          release = (url) => resolve({ ok: url !== null, url });
        }),
    );
    function Host({ assetId }: { readonly assetId: string | null }) {
      const url = useWallpaperAssetUrl(assetId, loader);
      return <div data-url={url ?? "none"} data-asset={assetId ?? "none"} />;
    }
    const { rerender, container } = render(<Host assetId="asset-a" />);
    expect(loader).toHaveBeenCalledWith("asset-a");
    // A's resolver, captured BEFORE the switch (release is reassigned by B).
    const releaseA = release!;

    // Switch to B before A resolves: the stale A result must never apply.
    rerender(<Host assetId="asset-b" />);
    releaseA!("blob:a");
    await act(async () => {
      await Promise.resolve();
    });
    expect((container.firstChild as HTMLElement).getAttribute("data-url")).toBe("none");

    // The CURRENT request's resolution does apply.
    release!("blob:b");
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() =>
      expect((container.firstChild as HTMLElement).getAttribute("data-url")).toBe("blob:b"),
    );
  });
});

describe("the Settings background editor (023-C.2)", () => {
  function renderSettings(props: {
    readonly onSave: (
      draft: WorkspaceSettingsDraft,
      images: readonly unknown[],
    ) => Promise<SettingsSaveResult>;
    readonly onPreviewBackground?: (preview: BackgroundPreview | null) => void;
    readonly backgroundEntrySectionId?: string | null;
    readonly activeSectionId?: string | null;
  }) {
    return render(
      <UiLocaleProvider>
        <SettingsCenter
          open={true}
          workspace={threePageWorkspace()}
          onPreviewAppearance={() => {}}
          onSave={props.onSave as never}
          onClose={() => {}}
          onPreviewBackground={props.onPreviewBackground}
          backgroundEntrySectionId={props.backgroundEntrySectionId ?? null}
          activeSectionId={props.activeSectionId ?? "page-1"}
        />
      </UiLocaleProvider>,
    );
  }

  it("a workspace preset pick previews the workspace layer and saves it as one patch", async () => {
    const previews: (BackgroundPreview | null)[] = [];
    const saved: WorkspaceSettingsDraft[] = [];
    const view = renderSettings({
      onSave: async (draft) => {
        saved.push(draft);
        return { ok: true };
      },
      onPreviewBackground: (preview) => previews.push(preview),
    });
    const mist = view.getByTestId("wallpaper-preset-mist");
    await act(async () => {
      fireEvent.click(mist);
    });
    expect(previews.at(-1)).toMatchObject({
      scope: "workspace",
      config: { kind: "preset", presetId: "mist" },
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /保存|Save/ }));
    });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.background.workspace).toEqual({ kind: "preset", presetId: "mist" });
  });

  it("a NON-active section scope edits by thumbnail only — no live desktop preview is published", async () => {
    const previews: (BackgroundPreview | null)[] = [];
    const saved: WorkspaceSettingsDraft[] = [];
    const view = renderSettings({
      onSave: async (draft) => {
        saved.push(draft);
        return { ok: true };
      },
      onPreviewBackground: (preview) => previews.push(preview),
      backgroundEntrySectionId: "page-2",
      activeSectionId: "page-1",
    });
    await act(async () => {
      fireEvent.click(view.getByTestId("wallpaper-preset-dawn"));
    });
    // The ACTIVE section (page-1) has no draft: nothing previews live.
    expect(previews.at(-1)).toBeNull();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /保存|Save/ }));
    });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.background.pages["page-2"]).toEqual({ kind: "preset", presetId: "dawn" });
  });

  it("Follow workspace previews inheritance (null patch), and scope switches keep both dirty drafts", async () => {
    const previews: (BackgroundPreview | null)[] = [];
    const saved: WorkspaceSettingsDraft[] = [];
    const view = renderSettings({
      onSave: async (draft) => {
        saved.push(draft);
        return { ok: true };
      },
      onPreviewBackground: (preview) => previews.push(preview),
      backgroundEntrySectionId: "page-1",
      activeSectionId: "page-1",
    });
    // Section scope: pick Follow workspace (clears any override) then also
    // draft the workspace layer — both patches ride one save.
    const follow = view.getByRole("radio", { name: /跟随工作区|Follow workspace/ }).closest("button") ?? view.getByRole("radio", { name: /跟随工作区|Follow workspace/ });
    await act(async () => {
      fireEvent.click(view.getByTestId("wallpaper-preset-mist"));
    });
    expect(previews.at(-1)).toMatchObject({ scope: "page-1", config: { kind: "preset", presetId: "mist" } });
    void follow;
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /保存|Save/ }));
    });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.background.pages["page-1"]).toEqual({ kind: "preset", presetId: "mist" });
  });
});
