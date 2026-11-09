import { describe, expect, it } from "vitest";

import { createEmptyWorkspace } from "./workspace";
import { replacePageModeWallpaper, replacePageWallpaper } from "./editing";
import { decodeWorkspaceSnapshot } from "./decoding";
import {
  DEFAULT_WALLPAPER,
  isWallpaperConfig,
  resolveEffectiveWallpaper,
  resolveModeAwareWallpaper,
} from "./wallpaper";
import type { WallpaperConfig } from "./wallpaper";

function snapshotWithPageWallpaper(pageWallpaper?: WallpaperConfig) {
  const base = createEmptyWorkspace({
    workspaceId: "ws-1",
    workspaceName: "W",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 3, rows: 3 },
  });
  return {
    ...base,
    pages:
      pageWallpaper === undefined
        ? base.pages
        : base.pages.map((page) =>
            page.id === "page-1" ? { ...page, wallpaper: pageWallpaper } : page,
          ),
  };
}

describe("isWallpaperConfig (023-C.1 validation)", () => {
  it("accepts recognized presets and well-formed asset configs", () => {
    expect(isWallpaperConfig({ kind: "preset", presetId: "aurora" })).toBe(true);
    expect(
      isWallpaperConfig({ kind: "asset", assetId: "sha256:abc", fit: "cover", position: "center" }),
    ).toBe(true);
  });

  it("rejects unknown kinds, preset ids, blank asset ids, bad fits and positions", () => {
    expect(isWallpaperConfig(null)).toBe(false);
    expect(isWallpaperConfig({ kind: "gradient" })).toBe(false);
    expect(isWallpaperConfig({ kind: "preset", presetId: "neon" })).toBe(false);
    expect(isWallpaperConfig({ kind: "asset", assetId: "", fit: "cover", position: "center" })).toBe(false);
    expect(isWallpaperConfig({ kind: "asset", assetId: "a", fit: "stretch", position: "center" })).toBe(false);
    expect(isWallpaperConfig({ kind: "asset", assetId: "a", fit: "cover", position: "top-left" })).toBe(false);
  });
});

describe("resolveEffectiveWallpaper precedence (023-C.1)", () => {
  const preset = (id: string): WallpaperConfig => ({ kind: "preset", presetId: id as never });
  const asset = (id: string): WallpaperConfig => ({
    kind: "asset",
    assetId: id,
    fit: "cover",
    position: "center",
  });

  it("page override wins over the workspace layer; provenance is section", () => {
    expect(
      resolveEffectiveWallpaper({
        page: { wallpaper: preset("dawn") },
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: asset("ws-img"),
        workspaceDraft: undefined,
        legacyWorkspacePreset: "aurora",
      }),
    ).toEqual({ config: preset("dawn"), provenance: "section" });
  });

  it("explicit workspace wallpaper beats the legacy preset", () => {
    expect(
      resolveEffectiveWallpaper({
        page: undefined,
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: asset("ws-img"),
        workspaceDraft: undefined,
        legacyWorkspacePreset: "aurora",
      }),
    ).toEqual({ config: asset("ws-img"), provenance: "workspace" });
  });

  it("absent new config resolves through the legacy preset (old snapshots)", () => {
    expect(
      resolveEffectiveWallpaper({
        page: undefined,
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: undefined,
        workspaceDraft: undefined,
        legacyWorkspacePreset: "mist",
      }),
    ).toEqual({ config: { kind: "preset", presetId: "mist" }, provenance: "workspace" });
  });

  it("a workspace draft substitutes ONLY the workspace layer — a saved page override stays", () => {
    expect(
      resolveEffectiveWallpaper({
        page: { wallpaper: preset("dawn") },
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: undefined,
        workspaceDraft: { config: asset("draft-img") },
        legacyWorkspacePreset: "aurora",
      }),
    ).toEqual({ config: preset("dawn"), provenance: "section" });

    // Without an override, the same draft IS the effective workspace layer.
    expect(
      resolveEffectiveWallpaper({
        page: undefined,
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: asset("saved"),
        workspaceDraft: { config: asset("draft-img") },
        legacyWorkspacePreset: "aurora",
      }),
    ).toEqual({ config: asset("draft-img"), provenance: "workspace" });
  });

  it("an explicit Follow-workspace page draft previews inheritance before Save", () => {
    expect(
      resolveEffectiveWallpaper({
        page: { wallpaper: preset("dawn") },
        pageWallpaperDraft: null,
        pageWallpaperExplicitlyInherits: true,
        workspaceWallpaper: asset("ws-img"),
        workspaceDraft: undefined,
        legacyWorkspacePreset: "aurora",
      }),
    ).toEqual({ config: asset("ws-img"), provenance: "workspace" });
  });

  it("a page draft (including a removed image) substitutes only that page's layer", () => {
    expect(
      resolveEffectiveWallpaper({
        page: { wallpaper: preset("dawn") },
        pageWallpaperDraft: asset("page-img"),
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: asset("ws-img"),
        workspaceDraft: undefined,
        legacyWorkspacePreset: "aurora",
      }),
    ).toEqual({ config: asset("page-img"), provenance: "section" });

    expect(
      resolveEffectiveWallpaper({
        page: { wallpaper: preset("dawn") },
        pageWallpaperDraft: null,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: asset("ws-img"),
        workspaceDraft: undefined,
        legacyWorkspacePreset: "aurora",
      }),
    ).toEqual({ config: asset("ws-img"), provenance: "workspace" });
  });

  it("an invalid legacy preset falls to the application default", () => {
    expect(
      resolveEffectiveWallpaper({
        page: undefined,
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: undefined,
        workspaceDraft: undefined,
        legacyWorkspacePreset: "gone" as never,
      }),
    ).toEqual({ config: DEFAULT_WALLPAPER, provenance: "default" });
  });
});

describe("snapshot decoding with wallpapers (023-C.1)", () => {
  it("decodes valid page and workspace wallpapers; drops structurally invalid ones", () => {
    const withPage = snapshotWithPageWallpaper({ kind: "preset", presetId: "dawn" });
    expect(decodeWorkspaceSnapshot(withPage)?.pages[0]?.wallpaper).toEqual({
      kind: "preset",
      presetId: "dawn",
    });

    const invalid = snapshotWithPageWallpaper({ kind: "preset", presetId: "neon" } as never);
    // The invalid override makes the page undecodable → the whole snapshot
    // is rejected (structural decode never silently rewrites content).
    expect(decodeWorkspaceSnapshot(invalid)).toBeUndefined();

    const withWorkspace = {
      ...createEmptyWorkspace({
        workspaceId: "ws-1",
        workspaceName: "W",
        pageId: "page-1",
        pageName: "Home",
        grid: { columns: 3, rows: 3 },
      }),
      preferences: {
        defaultPageId: "page-1",
        layoutLocked: false,
        appearance: undefined,
      },
    };
    expect(decodeWorkspaceSnapshot(withWorkspace)).toBeDefined();
  });

  it("old snapshots without any wallpaper field decode exactly as before", () => {
    const legacy = createEmptyWorkspace({
      workspaceId: "ws-1",
      workspaceName: "W",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 3, rows: 3 },
    });
    const decoded = decodeWorkspaceSnapshot(legacy);
    expect(decoded).toBeDefined();
    expect(decoded?.pages[0]?.wallpaper).toBeUndefined();
  });
});

describe("replacePageWallpaper (023-C.1)", () => {
  it("sets and removes an override immutably, touching nothing else", () => {
    const base = snapshotWithPageWallpaper(undefined);
    const config: WallpaperConfig = { kind: "preset", presetId: "mist" };

    const set = replacePageWallpaper(base, "page-1", config);
    expect(set.ok).toBe(true);
    if (set.ok) {
      expect(set.workspace.pages[0]?.wallpaper).toEqual(config);
      // Non-mutation: the input is untouched; geometry/order/membership stay.
      expect(base.pages[0]?.wallpaper).toBeUndefined();
      expect(set.workspace.pages[0]?.layout).toEqual(base.pages[0]?.layout);
      expect(set.workspace.pages).toHaveLength(base.pages.length);
      // Reset removes ONLY the override.
      const cleared = replacePageWallpaper(set.workspace, "page-1", null);
      expect(cleared.ok).toBe(true);
      if (cleared.ok) {
        expect(cleared.workspace.pages[0]?.wallpaper).toBeUndefined();
        expect(cleared.workspace.pages[0]?.name).toBe(base.pages[0]?.name);
      }
    }
  });

  it("refuses unknown pages and structurally invalid configs", () => {
    const base = snapshotWithPageWallpaper(undefined);
    expect(replacePageWallpaper(base, "gone", null)).toMatchObject({ ok: false });
    expect(
      replacePageWallpaper(base, "page-1", { kind: "preset", presetId: "neon" } as never),
    ).toMatchObject({ ok: false, reason: "invalid-wallpaper" });
  });
});

describe("resolveModeAwareWallpaper precedence (P1)", () => {
  const lightConfig: WallpaperConfig = { kind: "preset", presetId: "mist" };
  const darkConfig: WallpaperConfig = { kind: "preset", presetId: "midnight" };
  const generalConfig: WallpaperConfig = { kind: "preset", presetId: "dawn" };

  function baseInput() {
    return {
      page: undefined,
      pageWallpaperDraft: undefined,
      pageWallpaperExplicitlyInherits: false,
      workspaceWallpaper: undefined,
      workspaceDraft: undefined,
      legacyWorkspacePreset: "aurora" as const,
    };
  }

  it("prefers the effective mode's override over the page's general upload", () => {
    const page = {
      wallpaper: generalConfig,
      wallpaperByMode: { light: lightConfig, dark: darkConfig },
    };
    expect(
      resolveModeAwareWallpaper(
        { effectiveMode: "dark", page, modeWallpaperDraft: undefined },
        { ...baseInput(), page },
      ),
    ).toEqual({ config: darkConfig, provenance: "section" });
    expect(
      resolveModeAwareWallpaper(
        { effectiveMode: "light", page, modeWallpaperDraft: undefined },
        { ...baseInput(), page },
      ),
    ).toEqual({ config: lightConfig, provenance: "section" });
  });

  it("falls back per-mode to the page general upload, then the ordinary chain", () => {
    const page = { wallpaper: generalConfig, wallpaperByMode: { dark: darkConfig } };
    // Light has no override → the mode-agnostic page upload serves it.
    expect(
      resolveModeAwareWallpaper(
        { effectiveMode: "light", page, modeWallpaperDraft: undefined },
        { ...baseInput(), page },
      ),
    ).toEqual({ config: generalConfig, provenance: "section" });
    // No mode map at all → the ordinary resolver output, untouched.
    expect(
      resolveModeAwareWallpaper(
        { effectiveMode: "dark", page: undefined, modeWallpaperDraft: undefined },
        baseInput(),
      ),
    ).toEqual({ config: { kind: "preset", presetId: "aurora" }, provenance: "workspace" });
  });

  it("substitutes a matching mode draft and previews its explicit removal", () => {
    const page = { wallpaper: generalConfig, wallpaperByMode: { dark: darkConfig } };
    expect(
      resolveModeAwareWallpaper(
        { effectiveMode: "dark", page, modeWallpaperDraft: { mode: "dark", config: lightConfig } },
        { ...baseInput(), page },
      ),
    ).toEqual({ config: lightConfig, provenance: "section" });
    // null draft = removal → light falls to the page general layer.
    expect(
      resolveModeAwareWallpaper(
        { effectiveMode: "dark", page, modeWallpaperDraft: { mode: "dark", config: null } },
        { ...baseInput(), page },
      ),
    ).toEqual({ config: generalConfig, provenance: "section" });
  });

  it("never substitutes a draft that targets the other mode", () => {
    const page = { wallpaper: generalConfig, wallpaperByMode: { dark: darkConfig } };
    expect(
      resolveModeAwareWallpaper(
        { effectiveMode: "light", page, modeWallpaperDraft: { mode: "dark", config: lightConfig } },
        { ...baseInput(), page },
      ),
    ).toEqual({ config: generalConfig, provenance: "section" });
  });
});

describe("replacePageModeWallpaper (P1)", () => {
  const config: WallpaperConfig = { kind: "preset", presetId: "mist" };

  it("sets one mode without touching the general upload, and drops the map with the last override", () => {
    const base = snapshotWithPageWallpaper(config);
    const set = replacePageModeWallpaper(base, "page-1", "dark", { kind: "preset", presetId: "midnight" });
    expect(set.ok).toBe(true);
    if (!set.ok) {
      return;
    }
    expect(set.workspace.pages[0]?.wallpaper).toEqual(config);
    expect(set.workspace.pages[0]?.wallpaperByMode).toEqual({
      dark: { kind: "preset", presetId: "midnight" },
    });
    // Light joins independently; the input snapshot is never mutated.
    const both = replacePageModeWallpaper(set.workspace, "page-1", "light", config);
    expect(both.ok).toBe(true);
    if (both.ok) {
      expect(both.workspace.pages[0]?.wallpaperByMode).toEqual({
        light: config,
        dark: { kind: "preset", presetId: "midnight" },
      });
    }
    expect(base.pages[0]?.wallpaperByMode).toBeUndefined();
    // Removing the last override drops the whole map.
    const cleared = replacePageModeWallpaper(both.ok ? both.workspace : set.workspace, "page-1", "dark", null);
    const cleared2 = replacePageModeWallpaper(cleared.ok ? cleared.workspace : base, "page-1", "light", null);
    expect(cleared2.ok).toBe(true);
    if (cleared2.ok) {
      expect(cleared2.workspace.pages[0]?.wallpaperByMode).toBeUndefined();
      expect(cleared2.workspace.pages[0]?.wallpaper).toEqual(config);
    }
  });

  it("refuses unknown pages and structurally invalid configs", () => {
    const base = snapshotWithPageWallpaper(undefined);
    expect(replacePageModeWallpaper(base, "gone", "light", config)).toMatchObject({ ok: false });
    expect(
      replacePageModeWallpaper(base, "page-1", "light", { kind: "preset", presetId: "neon" } as never),
    ).toMatchObject({ ok: false, reason: "invalid-wallpaper" });
  });
});
