import type { AppShortcut, AppVisualStyle } from "./types";

/**
 * Per-app visual style: defaults, resolution and semantic validation.
 *
 * `DEFAULT_APP_VISUAL_STYLE` doubles as the Task016 visual baseline
 * (scale 1 + the existing gradient tile), so legacy apps without a
 * persisted `visual` render exactly like the pre-visual-style desktop.
 * Resolution never mutates and never stages a migration: old apps gain a
 * stored style only when the user actually saves the visual editor.
 *
 * Colors are persisted data boundaries: only exact `#RRGGBB` hex is ever
 * accepted — arbitrary CSS, `var(...)`, `url(...)`, `rgb(...)` and gradient
 * strings are rejected here so no renderer ever has to sanitize.
 */

export const DEFAULT_APP_VISUAL_STYLE: AppVisualStyle = {
  iconScale: 1,
  decorationStyle: "gradient",
};

/** Semantic range of `iconScale`: 50%–160% of the global base icon size. */
export const MIN_ICON_SCALE = 0.5;
export const MAX_ICON_SCALE = 1.6;

/** Exact `#RRGGBB` hex (uppercase or lowercase digits, both fine). */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Whether `value` is an exact `#RRGGBB` color. This is the single color
 * gate for every persisted per-app color field.
 */
export function isValidAppHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/** One semantic defect of a per-app visual style. Enum legality is structural. */
export type AppVisualValidationIssue =
  | {
      readonly type: "invalid-icon-scale";
    }
  | {
      readonly type: "invalid-foreground-color";
    }
  | {
      readonly type: "invalid-decoration-color";
    };

/**
 * The app's effective visual style: the persisted one when present,
 * otherwise the defaults for legacy apps. Pure — no mutation.
 */
export function resolveAppVisualStyle(app: AppShortcut): AppVisualStyle {
  return app.visual ?? DEFAULT_APP_VISUAL_STYLE;
}

/**
 * Semantic validation of a per-app visual style (structurally decoded data
 * is still in range). Deterministic issue order: iconScale,
 * foregroundColor, decorationColor. Never throws, never mutates.
 */
export function validateAppVisualStyle(
  style: AppVisualStyle
): readonly AppVisualValidationIssue[] {
  const issues: AppVisualValidationIssue[] = [];

  if (
    !Number.isFinite(style.iconScale) ||
    style.iconScale < MIN_ICON_SCALE ||
    style.iconScale > MAX_ICON_SCALE
  ) {
    issues.push({ type: "invalid-icon-scale" });
  }
  if (
    style.foregroundColor !== undefined &&
    !isValidAppHexColor(style.foregroundColor)
  ) {
    issues.push({ type: "invalid-foreground-color" });
  }
  if (
    style.decorationColor !== undefined &&
    !isValidAppHexColor(style.decorationColor)
  ) {
    issues.push({ type: "invalid-decoration-color" });
  }

  return issues;
}
