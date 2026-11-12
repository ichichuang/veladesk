"use client";

import type { RefObject } from "react";
import { useCallback } from "react";

import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";
import { replaceWorkspacePreferences } from "@veladesk/domain";
import type { DesktopPageId, WorkspaceAppearancePreferences } from "@veladesk/domain";

import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { retainWallpaperAssetUrl } from "../desktop-wallpaper";
import type { PreparedWallpaperImage } from "../wallpaper-prep";
import { applySettingsDraftToSnapshot } from "../settings-draft";
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
  /** Live Settings draft projection (t137): the desktop previews it. */
  readonly setSettingsDraftPreview: (next: WorkspaceSettingsDraft | null) => void;
  readonly setSettingsBackgroundSection: (next: DesktopPageId | null) => void;
  readonly setSettingsOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  /** Whether Settings is already open (entry guards keep a live session). */
  readonly settingsOpen: boolean;
  readonly setPendingGapPx: (gapPx: number | null) => void;
}

/**
 * The shell's Settings session (P1-ENG-1), extracted verbatim from the
 * former desktop-shell.tsx: open/close with preview hygiene, the
 * save-then-stage transaction (asset-before-workspace ordering), and the
 * grid-gap live preview.
 *
 * t137: Settings is LIVE on the desktop — while the window is open the
 * shell renders the session draft (theme + background patches) through the
 * preview states below. Save persists the draft; Cancel/Escape/close drop
 * the previews and the desktop returns to the snapshot as it was when
 * Settings opened (nothing was staged before Save).
 */
export function useShellSettings(input: UseShellSettingsInput) {
  const {
    runtime,
    t,
    workspaceRef,
    layoutQueueRef,
    setContextMenu,
    setAppearancePreview,
    setSettingsDraftPreview,
    setSettingsBackgroundSection,
    setSettingsOpen,
    settingsOpen,
    setPendingGapPx,
  } = input;

  /**
   * Settings is the top surface: opening it clears any stale preview and
   * closes stray presentation state, but never stacks on top of another
   * modal (the keyboard guard and entry points keep it exclusive). An
   * entry while Settings is ALREADY open keeps the live session untouched
   * (the draft and its desktop preview belong to the user mid-edit).
   */
  function openSettings() {
    setContextMenu(null);
    if (settingsOpen) {
      return;
    }
    setAppearancePreview(null);
    setSettingsDraftPreview(null);
    setSettingsBackgroundSection(null);
    setSettingsOpen(true);
  }

  /**
   * Enters Settings through a section's context menu (023-C.2, t137): the
   * SAME window and shared background editor open with that exact
   * section's scope preselected — no duplicate editor. While already open,
   * the scope FOLLOWS the newly right-clicked section (the editor's own
   * entry-scope effect) without touching the live draft session.
   */
  function openSectionBackgroundSettings(pageId: DesktopPageId) {
    setContextMenu(null);
    setSettingsBackgroundSection(pageId);
    if (settingsOpen) {
      return;
    }
    setAppearancePreview(null);
    setSettingsDraftPreview(null);
    setSettingsOpen(true);
  }

  /**
   * Cancel/close (t137): the previews die with the surface — the desktop
   * returns to the opened snapshot, nothing was staged.
   */
  function closeSettings() {
    setAppearancePreview(null);
    setSettingsDraftPreview(null);
    setSettingsBackgroundSection(null);
    setSettingsOpen(false);
  }

  /**
   * Settings save path: draft → full preferences → immutable domain edit →
   * local stage + sync attempt. The appearance persisted on success, so
   * the preview can be dropped without a theme flash-back. Staging
   * failures keep Settings open with the preview alive for correction.
   *
   * t148: the draft lands on the snapshot through the ONE shared
   * projection (applySettingsDraftToSnapshot in settings-draft.ts) the
   * shell's live desktop preview ALSO uses — Save and preview can never
   * disagree. Only the image-asset staging (a side-effectful runtime
   * step) stays here. The projection stops at the FIRST refusal (a
   * deleted target page), keeping that failure for the mapping below.
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

    // The workspace wallpaper patch rides the preferences edit (null means
    // removal — the field is omitted so the legacy preset resolves again),
    // then the scoped page patches land on the result; all inside the ONE
    // shared projection (see the doc above).
    const result = applySettingsDraftToSnapshot(workspaceRef.current.snapshot, draft);
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
    // Retain each staged image's preview URL in the wallpaper asset cache
    // (UX-02) BEFORE the workspace stage lands: the store write inside the
    // stage re-renders the desktop, and that render must already find the
    // URL in the cache — otherwise it kicks off a fresh asset load and the
    // config/URL identity breaks (a crossfade through a second URL for the
    // same bytes). Content-addressed ids make the preview bytes the staged
    // bytes, so the retained URL is a faithful stand-in.
    for (const image of images) {
      retainWallpaperAssetUrl(image.asset.id, image.previewUrl);
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      console.error(`VelaDesk: settings were not staged (${staged.reason})`);
      return { ok: false, message: t("settings.error.saveFailed") };
    }
    // Success: the previews clear; the snapshot now carries the same
    // configs, so nothing flashes back and no dead blob ever intervenes.
    setAppearancePreview(null);
    setSettingsDraftPreview(null);
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
