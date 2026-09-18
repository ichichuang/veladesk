import { resolveWorkspaceAppearance } from "@veladesk/domain";
import type {
  DesktopPageId,
  WorkspaceAppearancePreferences,
  WorkspacePreferences,
  WorkspaceSnapshot,
} from "@veladesk/domain";

/**
 * Pure draft model of the Settings Center.
 *
 * The draft is the session-only editable copy of everything the settings
 * surface can change: the full appearance plus the two non-visual desktop
 * preferences. Drafts never touch the workspace snapshot — persistence
 * happens only through `preferencesFromSettingsDraft` +
 * `replaceWorkspacePreferences` at Save time.
 */

export interface WorkspaceSettingsDraft {
  readonly appearance: WorkspaceAppearancePreferences;

  readonly defaultPageId: DesktopPageId;

  readonly layoutLocked: boolean;
}

/**
 * Opens a draft from the current snapshot. Legacy snapshots without a
 * persisted appearance start from the resolved defaults.
 */
export function createWorkspaceSettingsDraft(
  workspace: WorkspaceSnapshot,
): WorkspaceSettingsDraft {
  return {
    appearance: resolveWorkspaceAppearance(workspace.preferences),
    defaultPageId: workspace.preferences.defaultPageId,
    layoutLocked: workspace.preferences.layoutLocked,
  };
}

/**
 * Converts a draft into a full preferences value. The appearance is stored
 * explicitly (a fresh copy), so saving always upgrades the snapshot to the
 * modern shape — including when the user never touched appearance.
 */
export function preferencesFromSettingsDraft(
  draft: WorkspaceSettingsDraft,
): WorkspacePreferences {
  return {
    defaultPageId: draft.defaultPageId,
    layoutLocked: draft.layoutLocked,
    appearance: { ...draft.appearance },
  };
}

/** Field-by-field equality (no JSON serialization) for dirty tracking. */
export function areWorkspaceSettingsDraftsEqual(
  a: WorkspaceSettingsDraft,
  b: WorkspaceSettingsDraft,
): boolean {
  return (
    a.defaultPageId === b.defaultPageId &&
    a.layoutLocked === b.layoutLocked &&
    a.appearance.colorMode === b.appearance.colorMode &&
    a.appearance.accentHue === b.appearance.accentHue &&
    a.appearance.wallpaperPreset === b.appearance.wallpaperPreset &&
    a.appearance.surfaceOpacity === b.appearance.surfaceOpacity &&
    a.appearance.blurPx === b.appearance.blurPx &&
    a.appearance.radiusPx === b.appearance.radiusPx &&
    a.appearance.iconSize === b.appearance.iconSize
  );
}
