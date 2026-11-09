/**
 * Backdrop-blur token constants — the typed JS mirror of the
 * `--vd-blur-*` declarations in `packages/ui/src/tokens.css`. Light mode
 * runs the whole ladder softer (×⅔). The 清爽 material tier floors every
 * band to 0 (solid surfaces); 柔和 scales to ×0.6 — see material.ts.
 *
 * The window/popup blur stays runtime-configured per interface style
 * through the theme-emitted `--vd-window-blur` variable; these bands are
 * the semantic defaults for glass tiles, panels and the scene layer.
 */

/** Backdrop-blur bands (px) per color mode. */
export const VD_BLUR = {
  dark: {
    /** Glass tiles. */
    glass: 18,
    /** Menus, dialogs, windows. */
    panel: 28,
    /** The scene/wallpaper layer. */
    scene: 60,
  },
  light: {
    glass: 12,
    panel: 20,
    scene: 40,
  },
} as const;

/** A named blur band. */
export type VdBlurBand = keyof (typeof VD_BLUR)["dark"];

/** The 柔和 (soft) tier multiplies every band by this factor. */
export const VD_BLUR_SOFT_MULTIPLIER = 0.6;
