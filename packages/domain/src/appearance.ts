import type { WorkspaceAppearancePreferences, WorkspacePreferences } from "./types";

/**
 * Appearance defaults, resolution and semantic validation.
 *
 * `DEFAULT_WORKSPACE_APPEARANCE` doubles as the Task013 visual baseline
 * (dark + aurora + accent hue 205 + 0.55/18px/14px + medium icons), so
 * legacy snapshots without a persisted appearance render exactly like the
 * pre-settings desktop. Resolution never mutates and never stages a
 * migration: old snapshots gain a stored appearance only when the user
 * actually saves Settings.
 */

export const DEFAULT_WORKSPACE_APPEARANCE: WorkspaceAppearancePreferences = {
  colorMode: "dark",
  accentHue: 205,
  wallpaperPreset: "aurora",
  surfaceOpacity: 0.55,
  blurPx: 18,
  radiusPx: 14,
  iconSize: "medium",
};

/**
 * The workspace's effective appearance: the persisted one when present,
 * otherwise the defaults for legacy snapshots. Pure — no mutation.
 */
export function resolveWorkspaceAppearance(
  preferences: WorkspacePreferences
): WorkspaceAppearancePreferences {
  return preferences.appearance ?? DEFAULT_WORKSPACE_APPEARANCE;
}

/** One semantic defect of an appearance value. Enum legality is structural. */
export type WorkspaceAppearanceValidationIssue =
  | {
      readonly type: "invalid-accent-hue";
    }
  | {
      readonly type: "invalid-surface-opacity";
    }
  | {
      readonly type: "invalid-blur-px";
    }
  | {
      readonly type: "invalid-radius-px";
    };

/**
 * Semantic validation of appearance values (structurally decoded data is
 * still in range). Deterministic issue order: accentHue, surfaceOpacity,
 * blurPx, radiusPx. Never throws, never mutates.
 */
export function validateWorkspaceAppearance(
  appearance: WorkspaceAppearancePreferences
): readonly WorkspaceAppearanceValidationIssue[] {
  const issues: WorkspaceAppearanceValidationIssue[] = [];

  if (!Number.isInteger(appearance.accentHue) || appearance.accentHue < 0 || appearance.accentHue > 359) {
    issues.push({ type: "invalid-accent-hue" });
  }
  if (
    !Number.isFinite(appearance.surfaceOpacity) ||
    appearance.surfaceOpacity < 0.35 ||
    appearance.surfaceOpacity > 0.9
  ) {
    issues.push({ type: "invalid-surface-opacity" });
  }
  if (!Number.isInteger(appearance.blurPx) || appearance.blurPx < 0 || appearance.blurPx > 32) {
    issues.push({ type: "invalid-blur-px" });
  }
  if (!Number.isInteger(appearance.radiusPx) || appearance.radiusPx < 8 || appearance.radiusPx > 24) {
    issues.push({ type: "invalid-radius-px" });
  }

  return issues;
}
