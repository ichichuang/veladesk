import {
  inferInterfaceStyle,
  resolveGridGapPx,
  resolveInterfaceStyle,
  resolveWorkspaceAppearance,
} from "@veladesk/domain";
import type {
  DesktopPageId,
  WallpaperConfig,
  WorkspaceAppearancePreferences,
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
 */
export interface WorkspaceBackgroundPatches {
  readonly workspace: WallpaperConfig | null | undefined;
  readonly pages: Readonly<Record<DesktopPageId, WallpaperConfig | null>>;
}

export interface WorkspaceSettingsDraft {
  readonly appearance: WorkspaceAppearancePreferences;

  readonly defaultPageId: DesktopPageId;

  readonly layoutLocked: boolean;

  readonly gridGapPx: number;

  readonly background: WorkspaceBackgroundPatches;
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
    background: { workspace: undefined, pages: {} },
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
  return aKeys.every(
    (key) =>
      a.pages[key as DesktopPageId] === b.pages[key as DesktopPageId],
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
    backgroundPatchesEqual(a.background, b.background)
  );
}
