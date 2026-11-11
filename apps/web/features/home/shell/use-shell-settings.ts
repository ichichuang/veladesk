"use client";

import type { RefObject } from "react";
import { useCallback } from "react";

import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";
import {
  replacePageModeWallpaper,
  replacePageWallpaper,
  replaceWorkspacePreferences,
  resolveWorkspaceAppearance,
} from "@veladesk/domain";
import type {
  DesktopPageId,
  WorkspaceAppearancePreferences,
  WorkspaceEditResult,
  WorkspacePreferences,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import type { PageBackgroundPatch } from "../settings-draft";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { retainWallpaperAssetUrl, type BackgroundPreview } from "../desktop-wallpaper";
import type { PreparedWallpaperImage } from "../wallpaper-prep";
import { preferencesFromSettingsDraft } from "../settings-draft";
import type { WorkspaceSettingsDraft } from "../settings-draft";
import type { SettingsSaveResult } from "../settings-center";
import { stageWorkspaceAndTrySync } from "../workspace-commit";
import type { TranslateFn } from "../../i18n/use-i18n";
import type { ContextMenuState } from "../context-menu";

export interface UseShellSettingsInput {
  readonly runtime: WorkspaceClientRuntime;
  readonly t: TranslateFn;
  /** Latest-value mirror of the workspace record (staged edits). */
  readonly workspaceRef: RefObject<LocalWorkspaceRecord>;
  /** Serialized local-first commit queue (shared with the canvas commits). */
  readonly layoutQueueRef: RefObject<Promise<void>>;
  readonly setContextMenu: (next: ContextMenuState | null) => void;
  readonly setAppearancePreview: (next: WorkspaceAppearancePreferences | null) => void;
  readonly setBackgroundPreview: (next: BackgroundPreview | null) => void;
  readonly setSettingsBackgroundSection: (next: DesktopPageId | null) => void;
  readonly setSettingsOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  readonly setPendingGapPx: (gapPx: number | null) => void;
}

/**
 * The shell's Settings session (P1-ENG-1), extracted verbatim from the
 * former desktop-shell.tsx: open/close with preview hygiene, the
 * save-then-stage transaction (asset-before-workspace ordering), and the
 * grid-gap live preview.
 */
export function useShellSettings(input: UseShellSettingsInput) {
  const {
    runtime,
    t,
    workspaceRef,
    layoutQueueRef,
    setContextMenu,
    setAppearancePreview,
    setBackgroundPreview,
    setSettingsBackgroundSection,
    setSettingsOpen,
    setPendingGapPx,
  } = input;

  /**
   * Settings is the top surface: opening it clears any stale preview and
   * closes stray presentation state, but never stacks on top of another
   * modal (the keyboard guard and entry points keep it exclusive).
   */
  function openSettings() {
    setContextMenu(null);
    setAppearancePreview(null);
    setSettingsBackgroundSection(null);
    setSettingsOpen(true);
  }

  /**
   * Enters Settings through a section's context menu (023-C.2): the SAME
   * window and shared background editor open with that exact section's
   * scope preselected — no duplicate editor.
   */
  function openSectionBackgroundSettings(pageId: DesktopPageId) {
    setContextMenu(null);
    setAppearancePreview(null);
    setSettingsBackgroundSection(pageId);
    setSettingsOpen(true);
  }

  /** Cancel/close: the preview dies with the surface, nothing was staged. */
  function closeSettings() {
    setAppearancePreview(null);
    setBackgroundPreview(null);
    setSettingsBackgroundSection(null);
    setSettingsOpen(false);
  }

  /**
   * Applies every scoped background page patch (023-C.2 + P1 mode layers)
   * onto `base`: per page, up to three layers — the mode-agnostic upload
   * plus the optional light/dark overrides — each applied through its
   * dedicated immutable domain op. Stops at the FIRST refusal (a deleted
   * target page), keeping that failure for the caller's message mapping.
   */
  function applyBackgroundPatches(
    base: LocalWorkspaceRecord["snapshot"],
    pages: Readonly<Record<DesktopPageId, PageBackgroundPatch>>,
  ): WorkspaceEditResult {
    let result: WorkspaceEditResult = { ok: true, workspace: base };
    for (const [pageId, patch] of Object.entries(pages)) {
      if (patch === undefined) {
        continue;
      }
      const layers = [
        ...(patch.general !== undefined ? [["general", patch.general] as const] : []),
        ...(patch.light !== undefined ? [["light", patch.light] as const] : []),
        ...(patch.dark !== undefined ? [["dark", patch.dark] as const] : []),
      ] as const;
      for (const [layer, config] of layers) {
        const current: WorkspaceSnapshot = result.ok ? result.workspace : base;
        const next: WorkspaceEditResult =
          layer === "general"
            ? replacePageWallpaper(current, pageId, config)
            : replacePageModeWallpaper(current, pageId, layer, config);
        if (!next.ok) {
          return next;
        }
        result = next;
      }
    }
    return result;
  }

  /**
   * Settings save path: draft → full preferences → immutable domain edit →
   * local stage + sync attempt. The appearance persisted on success, so
   * the preview can be dropped without a theme flash-back. Staging
   * failures keep Settings open with the preview alive for correction.
   *
   * The active section stays untouched: a changed default section only
   * applies to the next session, never yanks the current view.
   */
  async function handleSettingsSave(
    draft: WorkspaceSettingsDraft,
    images: readonly PreparedWallpaperImage[] = [],
  ): Promise<SettingsSaveResult> {
    // 023-C.3 transaction: stage the required image ASSETS first (the
    // asset-before-workspace ordering), then apply ONE workspace edit that
    // carries the ordinary Settings changes AND every scoped background
    // patch — the normal result is ONE workspace revision, not one per
    // field or page. All patches apply to the CURRENT validated snapshot
    // (never the copy captured when Settings opened).
    if (images.length > 0) {
      try {
        const assetRuntime = await getBrowserAssetRuntime();
        for (const image of images) {
          const stagedAsset = await assetRuntime.stageAsset(image.asset.blob);
          if (!stagedAsset.ok) {
            return { ok: false, message: t("settings.error.wallpaperStageFailed") };
          }
        }
      } catch (error) {
        console.error("VelaDesk: wallpaper asset staging failed", error);
        return { ok: false, message: t("settings.error.wallpaperStageFailed") };
      }
    }

    // The workspace wallpaper patch rides the preferences edit; null means
    // removal (the field is omitted so the legacy preset resolves again).
    const draftPreferences = preferencesFromSettingsDraft(draft);
    const baseAppearance: WorkspaceAppearancePreferences =
      draftPreferences.appearance ?? resolveWorkspaceAppearance(draftPreferences);
    const appearance: WorkspaceAppearancePreferences =
      draft.background.workspace === undefined
        ? baseAppearance
        : draft.background.workspace === null
          ? (() => {
              const { wallpaper: removed, ...rest } = baseAppearance;
              void removed;
              return rest;
            })()
          : { ...baseAppearance, wallpaper: draft.background.workspace };
    const preferences: WorkspacePreferences = { ...draftPreferences, appearance };

    let result = replaceWorkspacePreferences(workspaceRef.current.snapshot, preferences);
    if (result.ok) {
      result = applyBackgroundPatches(result.workspace, draft.background.pages);
    }
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.reason === "page-not-found"
            ? t("settings.error.backgroundTargetGone")
            : result.reason === "default-page-not-found"
              ? t("settings.error.defaultPageGone")
              : result.reason === "invalid-grid-gap"
                ? t("settings.error.invalidGridGap")
                : result.reason === "invalid-wallpaper"
                  ? t("settings.error.invalidAppearance")
                  : t("settings.error.invalidAppearance"),
      };
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      console.error(`VelaDesk: settings were not staged (${staged.reason})`);
      return { ok: false, message: t("settings.error.saveFailed") };
    }
    // Success: both previews clear; the snapshot now carries the same
    // configs the preview showed, so nothing flashes back. Each staged
    // image's preview URL is retained in the wallpaper asset cache (UX-02):
    // the desktop keeps rendering the exact URL it already shows — the
    // config/URL identity is unchanged, so no crossfade (and no dead blob)
    // ever intervenes. Content-addressed ids make the preview bytes the
    // staged bytes.
    for (const image of images) {
      retainWallpaperAssetUrl(image.asset.id, image.previewUrl);
    }
    setAppearancePreview(null);
    setBackgroundPreview(null);
    setSettingsBackgroundSection(null);
    setSettingsOpen(false);
    return { ok: true };
  }

  /**
   * One completed toolbar gap change: preview immediately, persist once.
   * The preview clears once the authoritative snapshot carries the same
   * gap; a failed stage drops it (the visual grid returns to the persisted
   * value — an honest revert).
   */
  const handleGridGapChange = useCallback(
    (gapPx: number) => {
      setPendingGapPx(gapPx);
      const run = async () => {
        const current = workspaceRef.current;
        const replaced = replaceWorkspacePreferences(current.snapshot, {
          ...current.snapshot.preferences,
          gridGapPx: gapPx,
        });
        if (!replaced.ok) {
          console.error(`VelaDesk: grid gap change refused (${replaced.reason})`);
          setPendingGapPx(null);
          return;
        }
        const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
        if (!staged.ok) {
          console.error(`VelaDesk: grid gap change was not staged (${staged.reason})`);
          setPendingGapPx(null);
        }
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [runtime, workspaceRef, layoutQueueRef, setPendingGapPx]
  );

  return {
    openSettings,
    openSectionBackgroundSettings,
    closeSettings,
    handleSettingsSave,
    handleGridGapChange,
  };
}
