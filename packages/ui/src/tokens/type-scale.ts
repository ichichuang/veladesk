/**
 * Type-scale token constants — the typed JS mirror of the `--vd-type-*`
 * declarations in `packages/ui/src/tokens.css`. Seven steps only; `clock`
 * exists for exactly one consumer (the clock), `display` for the boot
 * wordmark and empty-state moments.
 */

/** The type scale (px). */
export const VD_TYPE_SCALE = {
  /** Micro metadata, hints, badges. */
  xs: 12,
  /** Tile labels, secondary rows. */
  sm: 13,
  /** Body, controls. */
  md: 15,
  /** Section titles, dialog emphasis. */
  lg: 18,
  /** Panel headers. */
  xl: 24,
  /** The wordmark / empty-state display size. */
  display: 40,
  /** The clock — and nothing else. */
  clock: 72,
} as const;

/** A named type-scale step. */
export type VdTypeStep = keyof typeof VD_TYPE_SCALE;
