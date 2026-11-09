/**
 * Backdrop-blur token constants (P1-ENG-1). The live window blur is
 * runtime-configured per interface style through the theme-emitted
 * `--vd-window-blur` variable; the value here is the FALLBACK the token
 * layer declares for solid (no-style) surfaces. New blur bands land here
 * once the visual designer's token draft is ratified — do not scatter
 * literals in the meantime.
 */

/** Window/popup backdrop blur fallback (px) — 0 means fully solid. */
export const VD_BLUR_WINDOW_FALLBACK_PX = 0;
