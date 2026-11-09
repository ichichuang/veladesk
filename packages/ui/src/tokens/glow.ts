/**
 * Glow token constants — the typed JS mirror of the `--vd-glow-*`
 * declarations in `packages/ui/src/tokens.css`. Glows are RESTRICTED to
 * focus, drag and the Wake light trail (one signature per surface); they
 * compose from the semantic accent/focus colors at the CSS layer via
 * color-mix, so re-huing the accent re-hues every glow.
 *
 * Light mode runs glows at ×0.6 intensity.
 */

/** The alpha/intensity of each glow band per mode. */
export const VD_GLOW = {
  dark: {
    /** Quiet halo under a focused/selected tile: 24px, accent 22%. */
    soft: { radius: 24, alpha: 0.22 },
    /** Focus ring: a 3px spread in focus color 45%. */
    focus: { spread: 3, alpha: 0.45 },
    /** Wake light trail: 32px, accent 35%. */
    wake: { radius: 32, alpha: 0.35 },
  },
  light: {
    soft: { radius: 24, alpha: 0.13 },
    focus: { spread: 3, alpha: 0.27 },
    wake: { radius: 32, alpha: 0.21 },
  },
} as const;

/** A named glow role. */
export type VdGlowRole = keyof (typeof VD_GLOW)["dark"];

/** Light-mode glow intensity multiplier (×0.6 per the token table). */
export const VD_GLOW_LIGHT_MULTIPLIER = 0.6;
