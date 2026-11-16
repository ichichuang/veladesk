import type {
  PageHelmClockOverride,
  WorkspaceAppearancePreferences,
  WorkspaceInterfaceStyle,
  WorkspacePreferences,
} from "./types";
export type { PageHelmClockOverride };

/**
 * Appearance defaults, resolution and semantic validation.
 *
 * `DEFAULT_WORKSPACE_APPEARANCE` is the Dawn Chart baseline (direction A,
 * P1): the dark 拂晓海图 main scene + the dawn horizon preset + the Dawn
 * apricot accent hue 60 + 0.55/18px/14px + medium icons. Dark is the
 * DEFAULT main scene (the director's 2026-11-10 call: the first picture is
 * the dark dawn chart; 白昼海图 light stays a first-class second tier the
 * user can pick, including "system"). Snapshots persisted before the
 * palette adoption keep their stored values (aurora-era presets included)
 * verbatim — resolution never mutates and never stages a migration; old
 * snapshots gain a stored appearance only when the user actually saves
 * Settings.
 */

export const DEFAULT_WORKSPACE_APPEARANCE: WorkspaceAppearancePreferences = {
  colorMode: "dark",
  accentHue: 60,
  wallpaperPreset: "chart",
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

/** The resolved clock/date presentation for one context (task 028). */
export interface HelmClockPresentation {
  readonly clockSizePx: number | undefined;
  readonly clockColor: string | undefined;
  readonly dateSizePx: number | undefined;
  readonly dateColor: string | undefined;
}

/**
 * The ONE clock/date presentation resolver (task 028): the visible
 * section's override wins FIELD BY FIELD, the workspace appearance fills
 * the rest, and anything still absent resolves to undefined (= the CSS
 * fluid defaults). Mirrors `resolveModeAwareWallpaper`'s page → workspace
 * inheritance. Pure — no mutation.
 */
export function resolveHelmClockPresentation(
  appearance: WorkspaceAppearancePreferences,
  page?: PageHelmClockOverride | undefined
): HelmClockPresentation {
  const clampSize = (value: number | undefined, min: number, max: number) =>
    value !== undefined && Number.isInteger(value) && value >= min && value <= max
      ? value
      : undefined;
  const exactHex = (value: string | undefined) =>
    value !== undefined && ACCENT_COLOR_PATTERN.test(value) ? value.toLowerCase() : undefined;
  return {
    clockSizePx:
      clampSize(page?.clockSizePx, MIN_HELM_CLOCK_SIZE_PX, MAX_HELM_CLOCK_SIZE_PX) ??
      clampSize(appearance.helmClockSizePx, MIN_HELM_CLOCK_SIZE_PX, MAX_HELM_CLOCK_SIZE_PX),
    clockColor:
      exactHex(page?.clockColor) ?? exactHex(appearance.helmClockColor),
    dateSizePx:
      clampSize(page?.dateSizePx, MIN_HELM_DATE_SIZE_PX, MAX_HELM_DATE_SIZE_PX) ??
      clampSize(appearance.helmDateSizePx, MIN_HELM_DATE_SIZE_PX, MAX_HELM_DATE_SIZE_PX),
    dateColor:
      exactHex(page?.dateColor) ?? exactHex(appearance.helmDateColor),
  };
}

/** Exact `#RRGGBB` hex (either case) — the accentColor persistence gate. */
const ACCENT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Semantic ranges of the helm clock/date presentation (task 028). The
 * clock must stay readable at the smallest desktop tile band (24px) yet
 * never crowd the whole header (160px); the date is a quiet caption.
 */
export const MIN_HELM_CLOCK_SIZE_PX = 24;
export const MAX_HELM_CLOCK_SIZE_PX = 160;
export const MIN_HELM_DATE_SIZE_PX = 10;
export const MAX_HELM_DATE_SIZE_PX = 36;

/** One semantic defect of an appearance value. Enum legality is structural. */
export type WorkspaceAppearanceValidationIssue =
  | {
      readonly type: "invalid-accent-hue";
    }
  | {
      readonly type: "invalid-accent-color";
    }
  | {
      readonly type: "invalid-helm-clock-size";
    }
  | {
      readonly type: "invalid-helm-clock-color";
    }
  | {
      readonly type: "invalid-helm-date-size";
    }
  | {
      readonly type: "invalid-helm-date-color";
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

/** Semantic validation of one per-section clock/date override block. */
export function validatePageHelmClockOverride(
  override: PageHelmClockOverride
): readonly WorkspaceAppearanceValidationIssue[] {
  const issues: WorkspaceAppearanceValidationIssue[] = [];
  const clockSize = override.clockSizePx;
  if (
    clockSize !== undefined &&
    (!Number.isInteger(clockSize) ||
      clockSize < MIN_HELM_CLOCK_SIZE_PX ||
      clockSize > MAX_HELM_CLOCK_SIZE_PX)
  ) {
    issues.push({ type: "invalid-helm-clock-size" });
  }
  if (override.clockColor !== undefined && !ACCENT_COLOR_PATTERN.test(override.clockColor)) {
    issues.push({ type: "invalid-helm-clock-color" });
  }
  const dateSize = override.dateSizePx;
  if (
    dateSize !== undefined &&
    (!Number.isInteger(dateSize) ||
      dateSize < MIN_HELM_DATE_SIZE_PX ||
      dateSize > MAX_HELM_DATE_SIZE_PX)
  ) {
    issues.push({ type: "invalid-helm-date-size" });
  }
  if (override.dateColor !== undefined && !ACCENT_COLOR_PATTERN.test(override.dateColor)) {
    issues.push({ type: "invalid-helm-date-color" });
  }
  return issues;
}

/**
 * Semantic validation of appearance values (structurally decoded data is
 * still in range). Deterministic issue order: accentHue, accentColor, the
 * four helm clock/date fields, surfaceOpacity, blurPx, radiusPx. Never
 * throws, never mutates.
 */
export function validateWorkspaceAppearance(
  appearance: WorkspaceAppearancePreferences
): readonly WorkspaceAppearanceValidationIssue[] {
  const issues: WorkspaceAppearanceValidationIssue[] = [];

  if (!Number.isInteger(appearance.accentHue) || appearance.accentHue < 0 || appearance.accentHue > 359) {
    issues.push({ type: "invalid-accent-hue" });
  }
  if (
    appearance.accentColor !== undefined &&
    !ACCENT_COLOR_PATTERN.test(appearance.accentColor)
  ) {
    issues.push({ type: "invalid-accent-color" });
  }
  const clockSize = appearance.helmClockSizePx;
  if (
    clockSize !== undefined &&
    (!Number.isInteger(clockSize) ||
      clockSize < MIN_HELM_CLOCK_SIZE_PX ||
      clockSize > MAX_HELM_CLOCK_SIZE_PX)
  ) {
    issues.push({ type: "invalid-helm-clock-size" });
  }
  if (appearance.helmClockColor !== undefined && !ACCENT_COLOR_PATTERN.test(appearance.helmClockColor)) {
    issues.push({ type: "invalid-helm-clock-color" });
  }
  const dateSize = appearance.helmDateSizePx;
  if (
    dateSize !== undefined &&
    (!Number.isInteger(dateSize) ||
      dateSize < MIN_HELM_DATE_SIZE_PX ||
      dateSize > MAX_HELM_DATE_SIZE_PX)
  ) {
    issues.push({ type: "invalid-helm-date-size" });
  }
  if (appearance.helmDateColor !== undefined && !ACCENT_COLOR_PATTERN.test(appearance.helmDateColor)) {
    issues.push({ type: "invalid-helm-date-color" });
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
