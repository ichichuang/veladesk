import { resolveInterfaceStyle } from "@veladesk/domain";
import type {
  WorkspaceAppearancePreferences,
  WorkspaceColorMode,
  WorkspaceWallpaperPreset,
} from "@veladesk/domain";

/**
 * Web theme adapter: turns persisted appearance preferences into the
 * controlled CSS custom properties and data attributes the desktop shell
 * consumes.
 *
 * The style object is a closed allowlist of `--vd-*` variables — never
 * arbitrary CSS — so the settings surface cannot inject styles into the
 * document. All values are plain strings; React applies them as inline
 * custom properties on the shell root.
 *
 * Surface parameters always flow through the canonical domain resolver
 * (`resolveInterfaceStyle`). A snapshot without a persisted
 * `interfaceStyle` keeps rendering its persisted raw values exactly as
 * before (the Task013 baseline guarantee) — only a Settings save
 * normalizes them into a style's canonical values.
 */

/**
 * Desktop icon tile size in px. `medium` is the Task013 baseline measured
 * from `home-shell.css` (62px); small/large scale around it. Only the icon
 * box scales — grid cells and drag metrics never change.
 */
export const ICON_SIZE_PX: Readonly<Record<WorkspaceAppearancePreferences["iconSize"], number>> = {
  small: 53, // ≈ 62 × 0.85
  medium: 62,
  large: 71, // ≈ 62 × 1.15
};

/** The strong-surface opacity tracks the base opacity, clamped below 1. */
const SURFACE_STRONG_DELTA = 0.23;
const SURFACE_STRONG_MAX = 0.98;

/** Shadow presets, exactly as the desktop CSS consumes them. */
const SURFACE_SHADOWS: Readonly<Record<"none" | "subtle" | "elevated", string>> = {
  none: "none",
  subtle: "0 1px 2px oklch(0 0 0 / 0.12), 0 6px 16px oklch(0 0 0 / 0.1)",
  elevated: "0 2px 6px oklch(0 0 0 / 0.18), 0 18px 40px oklch(0 0 0 / 0.28)",
};

export interface AppearanceTheme {
  readonly colorMode: WorkspaceColorMode;
  readonly wallpaperPreset: WorkspaceWallpaperPreset;
  readonly style: Readonly<Record<string, string>>;
}

/**
 * The color mode a surface actually renders: the product's "system" choice
 * resolved against the OS preference (021-R1). Every themed root — the
 * desktop and the shared overlay portal root — and every library theme
 * attribute must carry the EFFECTIVE value, never the raw "system"
 * preference, so portaled subtrees inherit one unambiguous palette.
 */
export type EffectiveColorMode = "light" | "dark";

/**
 * Resolves the persisted color-mode preference to its effective value.
 * Pure: `system` follows `systemPrefersLight`; explicit values pass through.
 */
export function resolveEffectiveColorMode(
  colorMode: WorkspaceColorMode,
  systemPrefersLight: boolean,
): EffectiveColorMode {
  if (colorMode === "light") {
    return "light";
  }
  if (colorMode === "dark") {
    return "dark";
  }
  return systemPrefersLight ? "light" : "dark";
}

/** Rounds away binary-float noise (0.55 + 0.23 → exactly 0.78). */
function formatUnitless(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Builds the theme for an appearance value. Pure: same input, same output,
 * no document access, no side effects.
 */
export function buildAppearanceTheme(
  appearance: WorkspaceAppearancePreferences,
): AppearanceTheme {
  // Legacy (pre-019-D) appearance: raw persisted values, unchanged look,
  // no shadow token — the CSS keeps its per-surface fallback shadows.
  const styled = appearance.interfaceStyle !== undefined;
  const surface = styled
    ? resolveInterfaceStyle(appearance.interfaceStyle)
    : {
        surfaceOpacity: appearance.surfaceOpacity,
        surfaceStrongOpacity: Math.min(
          SURFACE_STRONG_MAX,
          appearance.surfaceOpacity + SURFACE_STRONG_DELTA,
        ),
        blurPx: appearance.blurPx,
        radiusPx: appearance.radiusPx,
        borderStrength: 1,
        shadowPreset: "none" as const,
      };

  const style: Record<string, string> = {
    "--vd-accent-hue": String(appearance.accentHue),
    "--vd-surface-opacity": formatUnitless(surface.surfaceOpacity),
    "--vd-surface-strong-opacity": formatUnitless(surface.surfaceStrongOpacity),
    "--vd-blur": `${surface.blurPx}px`,
    "--vd-radius": `${surface.radiusPx}px`,
    "--vd-surface-border-strength": formatUnitless(surface.borderStrength),
    "--vd-icon-size": `${ICON_SIZE_PX[appearance.iconSize]}px`,
  };
  if (styled) {
    style["--vd-surface-shadow"] = SURFACE_SHADOWS[surface.shadowPreset];
    // The OVERLAY layer (settings window, dialogs, popovers) follows the
    // style too — "interface style" must be visible where the user is
    // looking while they preview. Legacy snapshots emit none of these, so
    // their windows stay exactly as solid as before.
    style["--vd-window-alpha"] = formatUnitless(surface.surfaceStrongOpacity);
    style["--vd-window-blur"] = `${surface.blurPx}px`;
  }

  return {
    colorMode: appearance.colorMode,
    wallpaperPreset: appearance.wallpaperPreset,
    style,
  };
}
