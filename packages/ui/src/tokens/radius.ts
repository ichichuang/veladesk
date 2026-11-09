/**
 * Radius + control-geometry token constants — the typed JS mirror of the
 * `--vd-radius-*` / `--vd-control-height` declarations in
 * `packages/ui/src/tokens.css`. Dawn Chart scale: tiles ride lg, panels xl,
 * buttons/controls md, hairline details sm.
 */

/** The radius scale (px). */
export const VD_RADIUS = {
  /** Hairline details, chips, tiny badges. */
  sm: 6,
  /** Buttons, inputs, popovers. */
  md: 10,
  /** Tiles. */
  lg: 16,
  /** Panels, dialogs. */
  xl: 24,
} as const;

/** A named radius step. */
export type VdRadiusStep = keyof typeof VD_RADIUS;

/** The radius (px) of designed controls — the `md` step. */
export const VD_RADIUS_CONTROL: (typeof VD_RADIUS)[VdRadiusStep] = VD_RADIUS.md;

/** Dialog/window radius (px) — the `xl` step. */
export const VD_RADIUS_DIALOG: (typeof VD_RADIUS)[VdRadiusStep] = VD_RADIUS.xl;

/** Standard control height (px) — the 36px touch row. */
export const VD_CONTROL_HEIGHT = 36;
