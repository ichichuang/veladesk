import {
  inferInterfaceStyle,
  replacePageHelmClock,
  replacePageModeWallpaper,
  replacePageWallpaper,
  replaceWorkspacePreferences,
  resolveGridGapPx,
  resolveInterfaceStyle,
  resolveWorkspaceAppearance,
} from "@veladesk/domain";
import type {
  DesktopPageId,
  PageHelmClockOverride,
  WallpaperConfig,
  WorkspaceEditResult,
  WorkspaceAppearancePreferences,
  WorkspaceMotionPreferences,
  WorkspacePreferences,
  WorkspaceSnapshot,
} from "@veladesk/domain";

/**
 * Pure draft model of the Settings Center (task 017 shape, 019-D surface
 * semantics).
 *
 * The draft is the session-only editable copy of everything the settings
 * surface can change: the full appearance (including the interface style),
 * the default section, the start-mode lock and the grid gap. The persisted
 * `iconSize` field stays inside `appearance` for backward compatibility —
 * it has no control in Settings V2, but saving unrelated settings preserves
 * it verbatim.
 *
 * Interface style: a snapshot without a persisted `interfaceStyle` opens
 * the draft on the NEAREST inferred preset — display only. Cancelling never
 * writes anything; a save normalizes the raw surface values into the chosen
 * style's canonical preset (`preferencesFromSettingsDraft`), after which
 * the persisted raw fields and the style can never disagree. Drafts never
 * touch the workspace snapshot — persistence happens only through
 * `preferencesFromSettingsDraft` + `replaceWorkspacePreferences` at Save.
 */

/**
 * Scoped background patches (023-C.2): one settings session edits the
 * workspace default AND any number of section overrides independently.
 * `undefined` = untouched (keeps the saved value); `null` = explicit
 * removal (workspace: back to the preset; section: follow the workspace).
 * A section patch carries up to three layers (P1): the mode-agnostic
 * `general` upload plus optional `light`/`dark` overrides.
 */
export interface PageBackgroundPatch {
  /** The mode-agnostic layer. `null` = Follow workspace. */
  readonly general?: WallpaperConfig | null;
  /** The light-mode override. `null` = override removed (falls to general). */
  readonly light?: WallpaperConfig | null;
  /** The dark-mode override. `null` = override removed (falls to general). */
  readonly dark?: WallpaperConfig | null;
}

export interface WorkspaceBackgroundPatches {
  readonly workspace: WallpaperConfig | null | undefined;
  readonly pages: Readonly<Record<DesktopPageId, PageBackgroundPatch>>;
}

/**
 * Scoped clock/date patches (task 028): the WORKSPACE fields live inside
 * the appearance (updateAppearance writes them); this record holds the
 * per-section overrides. `undefined` = untouched; `null` = follow the
 * workspace (the override is removed); a value = the section override.
 */
export interface WorkspaceHelmClockPatches {
  readonly pages: Readonly<Record<DesktopPageId, PageHelmClockOverride | null | undefined>>;
}

export interface WorkspaceSettingsDraft {
  readonly appearance: WorkspaceAppearancePreferences;

  readonly defaultPageId: DesktopPageId;

  readonly layoutLocked: boolean;

  readonly gridGapPx: number;

  /**
   * Motion preferences (P1): no Settings control edits them yet (the
   * helmMotion experiment flag is not exposed), but the draft must CARRY
   * them — a save replaces the whole preferences value and would otherwise
   * silently drop a persisted flag.
   */
  readonly motion?: WorkspaceMotionPreferences | undefined;

  readonly background: WorkspaceBackgroundPatches;

  readonly helmClock: WorkspaceHelmClockPatches;
}

/**
 * Opens a draft from the current snapshot. Legacy snapshots without a
 * persisted appearance/gap start from the resolved defaults, with the
 * interface style inferred from the raw surface values.
 */
export function createWorkspaceSettingsDraft(
  workspace: WorkspaceSnapshot,
): WorkspaceSettingsDraft {
  const appearance = resolveWorkspaceAppearance(workspace.preferences);
  return {
    appearance: {
      ...appearance,
      interfaceStyle: inferInterfaceStyle(appearance),
    },
    defaultPageId: workspace.preferences.defaultPageId,
    layoutLocked: workspace.preferences.layoutLocked,
    gridGapPx: resolveGridGapPx(workspace.preferences),
    motion: workspace.preferences.motion,
    background: { workspace: undefined, pages: {} },
    // task 028: pages with a PERSISTED clock/date override seed their patch
    // with it — the controls must show the saved values (a patch is the
    // whole block: editing one field without the seed would silently drop
    // the persisted siblings on the next save, because
    // `replacePageHelmClock` replaces the block wholesale). Seeding is
    // deterministic, so draft equality (dirty tracking) is unaffected.
    helmClock: {
      pages: Object.fromEntries(
        workspace.pages
          .filter((page) => page.helmClock !== undefined)
          .map((page) => [page.id, page.helmClock]),
      ),
    },
  };
}

/**
 * Converts a draft into a full preferences value. The appearance is stored
 * explicitly (a fresh copy), so saving always upgrades the snapshot to the
 * modern shape — including when the user never touched appearance. The
 * surface values are normalized into the chosen style's canonical preset,
 * so the persisted style and the raw fields always agree after a save.
 */
export function preferencesFromSettingsDraft(
  draft: WorkspaceSettingsDraft,
): WorkspacePreferences {
  const style = resolveInterfaceStyle(
    draft.appearance.interfaceStyle ?? inferInterfaceStyle(draft.appearance),
  );
  return {
    defaultPageId: draft.defaultPageId,
    layoutLocked: draft.layoutLocked,
    gridGapPx: draft.gridGapPx,
    // Motion rides along verbatim (see the draft field docs above).
    ...(draft.motion !== undefined ? { motion: draft.motion } : {}),
    appearance: {
      ...draft.appearance,
      surfaceOpacity: style.surfaceOpacity,
      blurPx: style.blurPx,
      radiusPx: style.radiusPx,
      interfaceStyle: style.style,
    },
  };
}

/** Structural equality for background patches (stable key order). */
function backgroundPatchesEqual(
  a: WorkspaceBackgroundPatches,
  b: WorkspaceBackgroundPatches,
): boolean {
  if (a.workspace !== b.workspace) {
    return false;
  }
  const aKeys = Object.keys(a.pages).sort();
  const bKeys = Object.keys(b.pages).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) {
    return false;
  }
  return aKeys.every((key) =>
    pageBackgroundPatchesEqual(
      a.pages[key as DesktopPageId],
      b.pages[key as DesktopPageId]
    )
  );
}

/** Field-by-field equality of one page's clock/date override (or null). */
function pageHelmClockOverrideEqual(
  a: PageHelmClockOverride | null | undefined,
  b: PageHelmClockOverride | null | undefined
): boolean {
  if (a === undefined || b === undefined || a === null || b === null) {
    return a === b;
  }
  return (
    a.clockSizePx === b.clockSizePx &&
    a.clockColor === b.clockColor &&
    a.dateSizePx === b.dateSizePx &&
    a.dateColor === b.dateColor
  );
}

/** Structural equality for the scoped clock/date patches (stable keys). */
function helmClockPatchesEqual(a: WorkspaceHelmClockPatches, b: WorkspaceHelmClockPatches): boolean {
  const aKeys = Object.keys(a.pages).sort();
  const bKeys = Object.keys(b.pages).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) {
    return false;
  }
  return aKeys.every((key) =>
    pageHelmClockOverrideEqual(a.pages[key as DesktopPageId], b.pages[key as DesktopPageId])
  );
}

/** Structural equality of one page's patch (layer by layer). */
function pageBackgroundPatchesEqual(
  a: PageBackgroundPatch | undefined,
  b: PageBackgroundPatch | undefined
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.general === b.general && a.light === b.light && a.dark === b.dark;
}

/** Field-by-field equality of the optional motion block. */
function motionPreferencesEqual(
  a: WorkspaceMotionPreferences | undefined,
  b: WorkspaceMotionPreferences | undefined
): boolean {
  return (
    a?.reducedMotion === b?.reducedMotion &&
    a?.experiments?.helmMotion === b?.experiments?.helmMotion
  );
}

/** Field-by-field equality (no JSON serialization) for dirty tracking. */
export function areWorkspaceSettingsDraftsEqual(
  a: WorkspaceSettingsDraft,
  b: WorkspaceSettingsDraft,
): boolean {
  return (
    a.defaultPageId === b.defaultPageId &&
    a.layoutLocked === b.layoutLocked &&
    a.gridGapPx === b.gridGapPx &&
    a.appearance.colorMode === b.appearance.colorMode &&
    a.appearance.accentHue === b.appearance.accentHue &&
    a.appearance.accentColor === b.appearance.accentColor &&
    a.appearance.wallpaperPreset === b.appearance.wallpaperPreset &&
    a.appearance.interfaceStyle === b.appearance.interfaceStyle &&
    // The raw surface fields stay part of equality: an external change to
    // them still counts as a different draft even though no control edits
    // them directly anymore.
    a.appearance.surfaceOpacity === b.appearance.surfaceOpacity &&
    a.appearance.blurPx === b.appearance.blurPx &&
    a.appearance.radiusPx === b.appearance.radiusPx &&
    // iconSize has no control in V2 but stays part of equality: an external
    // change to it still counts as a different draft.
    a.appearance.iconSize === b.appearance.iconSize &&
    // Helm clock/date presentation (task 028): the workspace fields are
    // plain optional strings/numbers — compare them exactly.
    a.appearance.helmClockSizePx === b.appearance.helmClockSizePx &&
    a.appearance.helmClockColor === b.appearance.helmClockColor &&
    a.appearance.helmDateSizePx === b.appearance.helmDateSizePx &&
    a.appearance.helmDateColor === b.appearance.helmDateColor &&
    // Block visibility (task 029): five optional booleans — a flipped
    // switch must mark the draft dirty even though `false` and `undefined`
    // render identically.
    a.appearance.showHelmClock === b.appearance.showHelmClock &&
    a.appearance.showHelmDate === b.appearance.showHelmDate &&
    a.appearance.showCommandBar === b.appearance.showCommandBar &&
    a.appearance.showDock === b.appearance.showDock &&
    a.appearance.showSectionPill === b.appearance.showSectionPill &&
    motionPreferencesEqual(a.motion, b.motion) &&
    backgroundPatchesEqual(a.background, b.background) &&
    helmClockPatchesEqual(a.helmClock, b.helmClock)
  );
}

/**
 * The ONE projection a Settings draft applies to a snapshot (t148): the
 * exact sequence `handleSettingsSave` used to inline — full preferences
 * from the draft, the workspace wallpaper patch merged into the appearance
 * (`undefined` = untouched, `null` = removed so the legacy preset resolves
 * again, a value = written), `replaceWorkspacePreferences`, then the scoped
 * page patches. BOTH callers go through it — Save (persisting) and the
 * shell's live desktop preview — so what the desktop shows while Settings
 * is open is, by construction, what Save persists. Stops at the FIRST
 * refusal with that failure, exactly like the former save path.
 */
export function applySettingsDraftToSnapshot(
  base: WorkspaceSnapshot,
  draft: WorkspaceSettingsDraft,
): WorkspaceEditResult {
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
  const replaced: WorkspaceEditResult = replaceWorkspacePreferences(base, preferences);
  if (!replaced.ok) {
    return replaced;
  }
  const withBackground = applyBackgroundPatchesToSnapshot(replaced.workspace, {
    workspace: undefined,
    pages: draft.background.pages,
  });
  if (!withBackground.ok) {
    return withBackground;
  }
  return applyHelmClockPatchesToSnapshot(withBackground.workspace, draft.helmClock);
}

/**
 * Applies the draft's scoped clock/date patches through the SAME domain op
 * a Save uses (task 028): `null` removes the section override (follow the
 * workspace), a value writes it. Stops at the FIRST refusal — Save and
 * preview can never disagree.
 */
export function applyHelmClockPatchesToSnapshot(
  base: WorkspaceSnapshot,
  helmClock: WorkspaceHelmClockPatches
): WorkspaceEditResult {
  let result: WorkspaceEditResult = { ok: true, workspace: base };
  for (const [pageId, patch] of Object.entries(helmClock.pages)) {
    if (patch === undefined) {
      continue;
    }
    const current: WorkspaceSnapshot = result.ok ? result.workspace : base;
    const next = replacePageHelmClock(current, pageId as DesktopPageId, patch);
    if (!next.ok) {
      return next;
    }
    result = next;
  }
  return result;
}

/**
 * Applies the draft's scoped background patches onto `base` through the
 * same immutable domain ops a Save uses (t137 Settings live preview): the
 * returned snapshot is what the DESKTOP renders while Settings is open —
 * every background change is visible immediately, Save persists it, and
 * Cancel/Escape/close simply drops the projection (the persisted snapshot
 * was never touched, so the desktop returns to the opened state). Stops at
 * the FIRST refusal (a deleted target page) with that failure, exactly
 * like the save path — Save and preview can never disagree.
 */
export function applyBackgroundPatchesToSnapshot(
  base: WorkspaceSnapshot,
  background: WorkspaceBackgroundPatches,
): WorkspaceEditResult {
  let result: WorkspaceEditResult = { ok: true, workspace: base };
  for (const [pageId, patch] of Object.entries(background.pages)) {
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
          ? replacePageWallpaper(current, pageId as DesktopPageId, config)
          : replacePageModeWallpaper(current, pageId as DesktopPageId, layer, config);
      if (!next.ok) {
        return next;
      }
      result = next;
    }
  }
  return result;
}
