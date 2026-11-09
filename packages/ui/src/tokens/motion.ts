/**
 * Canonical motion tokens (task 022, GSAP edition). One preset module for
 * every GSAP-owned duration in the product; never scatter ad-hoc durations.
 *
 * Durations are SECONDS (GSAP's unit). The single canonical easing is
 * `power2.out` — a smooth ease-out with no bounce/elastic overshoot;
 * springs are not part of the product motion language. Grid/Freeform drag,
 * resize and snap landing never consume these values: those gestures stay
 * direct and precise.
 *
 * Tooltip intent delay (VD_TOOLTIP_OPEN_DELAY_MS), functional URL debounce
 * and wheel intent thresholds are SEMANTIC timing, not animation durations,
 * and deliberately do not live here.
 */

/** The one easing curve for every GSAP-owned surface transition. */
export const VD_MOTION_EASE = "power2.out";

/** Durations in seconds, by product band. */
export const VD_MOTION = {
  /** Hover/press feedback and small hover lifts. */
  hoverPress: 0.16,
  /** Switch/control state interpolation. */
  controlState: 0.22,
  /** Tooltip surface entrance (the 220ms INTENT delay is separate). */
  tooltip: 0.18,
  /** Popup band: popovers, selects, color picker, context menu, launcher. */
  popup: 0.24,
  /** Settings section pane content. */
  tabContent: 0.26,
  /** Moving selection indicators (rail). */
  indicator: 0.28,
  /** Dialog window entrance. */
  dialog: 0.34,
  /** Right-side inspector panel entrance. */
  inspector: 0.38,
  /** Section category page slide. */
  sectionPage: 0.5,
} as const;

export type VdMotionPreset = keyof typeof VD_MOTION;

/** The canonical duration (seconds) for a product motion band. */
export function vdMotionDuration(preset: VdMotionPreset): number {
  return VD_MOTION[preset];
}

/**
 * Duration tokens carry SECONDS as their unit contract (GSAP's native unit;
 * Motion consumes the same value unchanged, so one source serves both
 * engines). New duration tokens MUST stay seconds — never milliseconds.
 */
export type VdMotionDurationSeconds = number;

/**
 * The ease tokens as a GROUP (P1-ENG-1 type slot): every GSAP-owned easing,
 * keyed by role. `standard` is THE one canonical curve — identical to
 * {@link VD_MOTION_EASE}, which stays exported as the flat form every
 * existing consumer imports. Future roles (e.g. Orbits camera travel) land
 * here first, never as scattered literals.
 */
export const VD_MOTION_EASES = {
  /** The one canonical curve for every GSAP-owned surface transition. */
  standard: VD_MOTION_EASE,
} as const;

/** A named ease role in {@link VD_MOTION_EASES}. */
export type VdMotionEaseRole = keyof typeof VD_MOTION_EASES;

/** The literal ease value of a named role (a GSAP ease name). */
export type VdMotionEaseName = (typeof VD_MOTION_EASES)[VdMotionEaseRole];
