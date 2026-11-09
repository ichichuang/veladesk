"use client";

import { useCallback, useMemo } from "react";

import { resolveEffectiveWallpaper } from "@veladesk/domain";
import type {
  DesktopPageId,
  WorkspaceAppearancePreferences,
} from "@veladesk/domain";

import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { useWallpaperAssetUrl, type BackgroundPreview } from "../desktop-wallpaper";
import type { SectionNavMachine } from "../section-transition-machine";
import { visibleActiveIdOf } from "../section-transition-machine";

export interface UseSceneWallpaperInput {
  /** The navigation machine — the wallpaper binds to the VISIBLE page. */
  readonly sectionNavMachine: SectionNavMachine;
  readonly effectiveActivePageId: DesktopPageId | null;
  /** The RENDERED workspace's pages (appearance projection). */
  readonly renderedPages: readonly import("@veladesk/domain").DesktopPage[];
  /** Live Settings background draft (scope-keyed), or null. */
  readonly backgroundPreview: BackgroundPreview | null;
  /** The resolved appearance (preview ?? persisted). */
  readonly resolvedAppearance: WorkspaceAppearancePreferences;
}

/**
 * The scene's wallpaper resolution (P1-ENG-1), extracted verbatim from the
 * former desktop-shell.tsx: the effective wallpaper of the VISIBLE section,
 * its asset id, and the resolved object URL (including the pending-draft
 * preview URL). Rendering lives in SceneBackdrop; this hook only resolves.
 */
export function useSceneWallpaper(input: UseSceneWallpaperInput) {
  const { sectionNavMachine, effectiveActivePageId, renderedPages, backgroundPreview, resolvedAppearance } =
    input;

  /**
   * The effective wallpaper of the VISIBLE section (023-C.4): resolved
   * through the ONE canonical resolver with the Settings draft layers
   * substituted per scope (a workspace draft never masks a saved section
   * override). Bound to the machine-visible destination — never an early
   * requested id that has not become a visible page.
   */
  const visibleSectionId = visibleActiveIdOf(sectionNavMachine, effectiveActivePageId);
  const effectiveWallpaper = useMemo(() => {
    const page =
      visibleSectionId === null
        ? undefined
        : renderedPages.find((candidate) => candidate.id === visibleSectionId);
    const pageDraftActive =
      backgroundPreview !== null &&
      backgroundPreview.scope === visibleSectionId &&
      !backgroundPreview.explicitlyInherits;
    return resolveEffectiveWallpaper({
      page,
      pageWallpaperDraft: pageDraftActive ? backgroundPreview.config : undefined,
      pageWallpaperExplicitlyInherits:
        backgroundPreview !== null &&
        backgroundPreview.scope === visibleSectionId &&
        backgroundPreview.explicitlyInherits,
      workspaceWallpaper: resolvedAppearance.wallpaper,
      workspaceDraft:
        backgroundPreview !== null && backgroundPreview.scope === "workspace"
          ? { config: backgroundPreview.config }
          : undefined,
      legacyWorkspacePreset: resolvedAppearance.wallpaperPreset,
    });
  }, [renderedPages, visibleSectionId, backgroundPreview, resolvedAppearance]);

  /** Resolves asset-backed wallpapers through the existing asset runtime. */
  const loadWallpaperAsset = useCallback(async (assetId: string) => {
    try {
      const runtime = await getBrowserAssetRuntime();
      const result = await runtime.loadAsset(assetId);
      if (result.ok && "blob" in result && result.blob instanceof Blob) {
        return { ok: true, url: URL.createObjectURL(result.blob) };
      }
      return { ok: false, url: null };
    } catch {
      return { ok: false, url: null };
    }
  }, []);
  const wallpaperAssetId =
    effectiveWallpaper.config.kind === "asset" ? effectiveWallpaper.config.assetId : null;
  // Pending bytes are not staged yet. Resolve them only after Save drops
  // the preview, so an early miss cannot leave the saved image unresolved.
  const resolvedWallpaperUrl = useWallpaperAssetUrl(
    backgroundPreview?.pendingAssetId === wallpaperAssetId ? null : wallpaperAssetId,
    loadWallpaperAsset,
  );
  // A pending (not-yet-staged) image previews through its own object URL.
  const wallpaperAssetUrl =
    backgroundPreview?.pendingAssetId !== undefined &&
    backgroundPreview.pendingAssetId === wallpaperAssetId &&
    backgroundPreview.previewUrl !== undefined
      ? backgroundPreview.previewUrl
      : resolvedWallpaperUrl;

  return { effectiveWallpaper, wallpaperAssetUrl };
}
