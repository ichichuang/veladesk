"use client";

import { useCallback, useMemo, useState } from "react";

import { resolveModeAwareWallpaper } from "@veladesk/domain";
import type {
  DesktopPageId,
  WorkspaceAppearancePreferences,
} from "@veladesk/domain";

import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { useWallpaperAssetUrl } from "../desktop-wallpaper";
import type { SectionNavMachine } from "../section-transition-machine";
import { visibleActiveIdOf } from "../section-transition-machine";

export interface UseSceneWallpaperInput {
  /** The navigation machine — the wallpaper binds to the VISIBLE page. */
  readonly sectionNavMachine: SectionNavMachine;
  readonly effectiveActivePageId: DesktopPageId | null;
  /** The RENDERED workspace's pages (appearance + Settings preview projection). */
  readonly renderedPages: readonly import("@veladesk/domain").DesktopPage[];
  /** The resolved appearance — the LIVE Settings preview while one is open (t137). */
  readonly resolvedAppearance: WorkspaceAppearancePreferences;
  /**
   * The EFFECTIVE color mode ("dark"/"light", already resolved from
   * `system`) — the mode whose per-mode wallpaper override applies (P1).
   */
  readonly effectiveColorMode: "dark" | "light";
}

/**
 * The scene's wallpaper resolution (P1-ENG-1), extracted verbatim from the
 * former desktop-shell.tsx: the effective wallpaper of the VISIBLE section,
 * its asset id, and the resolved object URL. Rendering lives in
 * SceneBackdrop; this hook only resolves. Mode-aware (P1): the effective
 * color mode's page override substitutes first, then the page general
 * image → Dawn chain.
 *
 * t137: the desktop resolves the RENDERED pages and the LIVE appearance —
 * while Settings is open, its draft's page patches and wallpaper are in
 * the inputs already (the shell projects them), and a pending upload's
 * preview URL arrives through the shared asset cache the settings session
 * retains it in at pick time. Cancel/close drop the projection; nothing
 * was staged before Save.
 */
export function useSceneWallpaper(input: UseSceneWallpaperInput) {
  const {
    sectionNavMachine,
    effectiveActivePageId,
    renderedPages,
    resolvedAppearance,
    effectiveColorMode,
  } = input;

  /**
   * The effective wallpaper of the VISIBLE section (023-C.4): resolved
   * through the ONE canonical resolver against the persisted layers —
   * the effective mode's page override first, then the page general
   * image → workspace image → Dawn chain. Bound to the machine-visible
   * destination, never an early requested id that has not become a
   * visible page.
   */
  const [unavailableAssetIds, setUnavailableAssetIds] = useState<ReadonlySet<string>>(new Set());
  const visibleSectionId = visibleActiveIdOf(sectionNavMachine, effectiveActivePageId);
  const effectiveWallpaper = useMemo(() => {
    const page =
      visibleSectionId === null
        ? undefined
        : renderedPages.find((candidate) => candidate.id === visibleSectionId);
    return resolveModeAwareWallpaper(
      { effectiveMode: effectiveColorMode, page, modeWallpaperDraft: undefined, unavailableAssetIds },
      {
        page,
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: resolvedAppearance.wallpaper,
        workspaceDraft: undefined,
        legacyWorkspacePreset: resolvedAppearance.wallpaperPreset,
      },
    );
  }, [renderedPages, visibleSectionId, resolvedAppearance, effectiveColorMode, unavailableAssetIds]);

  /** Resolves asset-backed wallpapers through the existing asset runtime. */
  const loadWallpaperAsset = useCallback(async (assetId: string) => {
    try {
      const runtime = await getBrowserAssetRuntime();
      const result = await runtime.loadAsset(assetId);
      if (result.ok && "blob" in result && result.blob instanceof Blob) {
        const url = URL.createObjectURL(result.blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          return { ok: true, url };
        } catch {
          URL.revokeObjectURL(url);
        }
      }
    } catch {
      // A missing local blob or an unsupported image falls through the
      // same mode → general → Dawn chain without changing persisted data.
    }
    setUnavailableAssetIds((ids) => new Set([...ids, assetId]));
    return { ok: false, url: null };
  }, []);
  const wallpaperAssetId =
    effectiveWallpaper.config.kind === "asset" ? effectiveWallpaper.config.assetId : null;
  const wallpaperAssetUrl = useWallpaperAssetUrl(wallpaperAssetId, loadWallpaperAsset);

  return { effectiveWallpaper, wallpaperAssetUrl };
}
