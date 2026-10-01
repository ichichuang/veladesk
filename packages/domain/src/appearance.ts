import type {
  WorkspaceAppearancePreferences,
  WorkspaceInterfaceStyle,
  WorkspacePreferences,
} from "./types";

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

/** Every interface style, in display order. Enum legality is structural. */
export const INTERFACE_STYLES: readonly WorkspaceInterfaceStyle[] = ["clean", "soft", "glass"];

/**
 * The strong-surface opacity tracks the base opacity, clamped below 1.
 * Shared by the presets and the legacy fallback so the derived value never
 * depends on where the base value came from.
 */
const SURFACE_STRONG_DELTA = 0.23;
const SURFACE_STRONG_MAX = 0.98;

/** Everything the theme builder needs to paint one surface style. */
export interface InterfaceStyleParameters {
  readonly style: WorkspaceInterfaceStyle;
  readonly surfaceOpacity: number;
  readonly surfaceStrongOpacity: number;
  readonly blurPx: number;
  readonly radiusPx: number;
  /** Multiplier around the current baseline border (1 = unchanged look); the
 * CSS layer maps it to a mode-aware border color. */
  readonly borderStrength: number;
  readonly shadowPreset: "none" | "subtle" | "elevated";
}

/**
 * Canonical preset parameters per style. Every value stays inside the
 * persisted semantic ranges (0.35–0.9 / 0–32 / 8–24), so a save that
 * normalizes the raw fields to these values always validates.
 */
const INTERFACE_STYLE_PRESETS: Readonly<
  Record<WorkspaceInterfaceStyle, Omit<InterfaceStyleParameters, "style" | "surfaceStrongOpacity">>
> = {
  // High readability: mostly opaque, no backdrop blur, quiet edge, no lift.
  clean: { surfaceOpacity: 0.9, blurPx: 0, radiusPx: 10, borderStrength: 0.7, shadowPreset: "none" },
  // The comfortable middle: translucent but calm, moderate radius and shadow.
  soft: { surfaceOpacity: 0.72, blurPx: 10, radiusPx: 14, borderStrength: 1, shadowPreset: "subtle" },
  // Translucent with meaningful backdrop blur, bright border, stronger lift.
  glass: { surfaceOpacity: 0.5, blurPx: 24, radiusPx: 18, borderStrength: 1.7, shadowPreset: "elevated" },
};

/**
 * The one canonical surface-formula resolver (019-D): a style in, the full
 * parameter set out. Settings, the Inspector, dialogs and popovers never
 * invent their own surface values — the theme builder consumes this.
 * Pure: same input, equal fresh output, no mutation.
 */
export function resolveInterfaceStyle(
  style: WorkspaceInterfaceStyle
): InterfaceStyleParameters {
  const preset = INTERFACE_STYLE_PRESETS[style];
  return {
    style,
    ...preset,
    surfaceStrongOpacity: Math.min(SURFACE_STRONG_MAX, preset.surfaceOpacity + SURFACE_STRONG_DELTA),
  };
}

/**
 * Nearest preset for an appearance value — used ONLY for display when a
 * snapshot carries no persisted `interfaceStyle`. Deterministic weighted
 * distance over the three surface fields; ties prefer the earlier style in
 * `INTERFACE_STYLES`. Never writes, never suggests a mutation: the raw
 * values keep rendering until the user saves.
 */
export function inferInterfaceStyle(
  appearance: WorkspaceAppearancePreferences
): WorkspaceInterfaceStyle {
  if (appearance.interfaceStyle !== undefined) {
    return appearance.interfaceStyle;
  }
  let best: WorkspaceInterfaceStyle = INTERFACE_STYLES[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const style of INTERFACE_STYLES) {
    const preset = INTERFACE_STYLE_PRESETS[style];
    const score =
      ((appearance.surfaceOpacity - preset.surfaceOpacity) / 0.55) ** 2 +
      ((appearance.blurPx - preset.blurPx) / 32) ** 2 +
      ((appearance.radiusPx - preset.radiusPx) / 16) ** 2;
    if (score < bestScore) {
      bestScore = score;
      best = style;
    }
  }
  return best;
}

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
