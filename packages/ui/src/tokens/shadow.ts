/**
 * Elevation shadow token constants — the typed JS mirror of the
 * `--vd-shadow-*` declarations in `packages/ui/src/tokens.css`. Dawn Chart
 * shadows ride the scene bottom color (bg.deep) in dark mode and the
 * primary foreground at 8–14% in light mode; every tile shadow carries the
 * 1px highlight stroke as its first layer (the "glass rim").
 */

/** The structured layers of one elevation shadow. */
export interface VdShadowSpec {
  /** The 1px top highlight stroke (tile shadows only; `null` = none). */
  readonly highlightStroke: boolean;
  /** The soft drop shadow: y offset, blur radius, shadow-color alpha. */
  readonly drop: readonly [y: number, blur: number, alpha: number];
}

/** Elevation shadows per color mode. */
export const VD_SHADOW = {
  dark: {
    /** Tiles: 0 1px 0 highlight, 0 8px 24px bg.deep 40%. */
    tile: { highlightStroke: true, drop: [8, 24, 0.4] } as const,
    /** Panels/dialogs: 0 24px 64px bg.deep 55%. */
    panel: { highlightStroke: false, drop: [24, 64, 0.55] } as const,
  },
  light: {
    /** Shadow color = fg.primary at 8–14% (白昼海图 light lift). */
    tile: { highlightStroke: true, drop: [8, 24, 0.08] } as const,
    panel: { highlightStroke: false, drop: [24, 64, 0.14] } as const,
  },
} as const;

/** A named elevation shadow. */
export type VdShadowRole = keyof (typeof VD_SHADOW)["dark"];
