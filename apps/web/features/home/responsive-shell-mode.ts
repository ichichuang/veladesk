/**
 * The canonical workspace shell mode (task 026 §5/§6): which presentation
 * shell — desktop authoring or mobile consumption — owns the workspace UI
 * right now.
 *
 * Capability/media queries ONLY, never UA sniffing (§5): the resolver input
 * is two booleans supplied by matchMedia, so tests and the hook share the
 * exact same decision table.
 *
 *   A. Narrow viewport (<= 767px, any pointer)          → mobile
 *   B. 768–1024px AND no hover AND coarse PRIMARY
 *      pointer (touch tablets, phones landscape)        → mobile
 *   C. > 767px with a fine primary pointer               → desktop
 *
 * `any-pointer: coarse` is deliberately NOT a leg: a laptop with a
 * touchscreen keeps the desktop shell because its PRIMARY input stays
 * fine. A phone rotated to landscape (844px wide) still matches leg B —
 * the coarse/no-hover conditions are exactly what keeps landscape phones
 * out of the desktop layout (§8).
 */

/** Which interaction shell owns the workspace presentation. */
export type WorkspaceShellMode = "desktop" | "mobile";

/**
 * Leg A: narrow viewports. Everything at or below 767px is mobile,
 * whatever the pointer hardware is.
 */
export const NARROW_VIEWPORT_QUERY = "(max-width: 767px)";

/**
 * Leg B: touch-first mid-size viewports (768–1024px) whose PRIMARY pointer
 * is coarse and cannot hover — touch tablets in both orientations and
 * phones in landscape.
 */
export const COARSE_TOUCH_VIEWPORT_QUERY =
  "(max-width: 1024px) and (hover: none) and (pointer: coarse)";

/** The canonical mobile shell query (the union of both legs). */
export const MOBILE_SHELL_QUERY = `${NARROW_VIEWPORT_QUERY}, ${COARSE_TOUCH_VIEWPORT_QUERY}`;

/**
 * The pure decision table. Both legs independently select mobile; anything
 * else is desktop. No history, no hysteresis — the mode is fully derived
 * from the current capability match and never persisted (§86).
 */
export function resolveWorkspaceShellMode(matches: {
  readonly narrowViewport: boolean;
  readonly coarseTouchViewport: boolean;
}): WorkspaceShellMode {
  return matches.narrowViewport || matches.coarseTouchViewport ? "mobile" : "desktop";
}

/** Reads both legs against a MediaQueryList-like `matchMedia` source. */
export function readShellModeMatches(
  matchMedia: (query: string) => { readonly matches: boolean },
): { readonly narrowViewport: boolean; readonly coarseTouchViewport: boolean } {
  return {
    narrowViewport: matchMedia(NARROW_VIEWPORT_QUERY).matches,
    coarseTouchViewport: matchMedia(COARSE_TOUCH_VIEWPORT_QUERY).matches,
  };
}
