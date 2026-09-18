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

export interface AppearanceTheme {
  readonly colorMode: WorkspaceColorMode;
  readonly wallpaperPreset: WorkspaceWallpaperPreset;
  readonly style: Readonly<Record<string, string>>;
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
  const strongOpacity = Math.min(
    SURFACE_STRONG_MAX,
    appearance.surfaceOpacity + SURFACE_STRONG_DELTA,
  );
  return {
    colorMode: appearance.colorMode,
    wallpaperPreset: appearance.wallpaperPreset,
    style: {
      "--vd-accent-hue": String(appearance.accentHue),
      "--vd-surface-opacity": formatUnitless(appearance.surfaceOpacity),
      "--vd-surface-strong-opacity": formatUnitless(strongOpacity),
      "--vd-blur": `${appearance.blurPx}px`,
      "--vd-radius": `${appearance.radiusPx}px`,
      "--vd-icon-size": `${ICON_SIZE_PX[appearance.iconSize]}px`,
    },
  };
}
