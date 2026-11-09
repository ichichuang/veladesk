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
 * existing consumer imports. `travel` exists solely for the Orbits camera
 * and `exit` for leave tweens; neither may leak into ordinary surfaces.
 */
export const VD_MOTION_EASES = {
  /** The one canonical curve for every GSAP-owned surface transition. */
  standard: VD_MOTION_EASE,
  /** Orbits camera travel ONLY (motion-spec-p1 §1). */
  travel: "power3.inOut",
  /** Leave/exit tweens. */
  exit: "power2.in",
} as const;

/** A named ease role in {@link VD_MOTION_EASES}. */
export type VdMotionEaseRole = keyof typeof VD_MOTION_EASES;

/** The literal ease value of a named role (a GSAP ease name). */
export type VdMotionEaseName = (typeof VD_MOTION_EASES)[VdMotionEaseRole];

/** A CSS/Motion cubic-bezier curve: `[x1, y1, x2, y2]`. */
export type VdMotionBezier = readonly [number, number, number, number];

/**
 * The ease tokens for MOTION-owned surfaces (Motion cannot parse GSAP ease
 * names): every {@link VD_MOTION_EASES} role as the cubic-bezier twin of
 * its GSAP curve, plus `linear` for the reduced-motion crossfades. GSAP's
 * `powerN` family maps onto the classic polynomial eases (power1 = quad,
 * power2 = cubic, power3 = quart), so the twins are the standard bezier
 * approximations of those curves. Motion components import these; GSAP
 * timelines keep {@link VD_MOTION_EASES}.
 */
export const VD_MOTION_EASES_BEZIER = {
  /** power2.out — ease-out cubic. */
  standard: [0.33, 1, 0.68, 1],
  /** power3.inOut — ease-in-out quart (Orbits camera only). */
  travel: [0.76, 0, 0.24, 1],
  /** power2.in — ease-in cubic (leave/exit). */
  exit: [0.32, 0, 0.67, 0],
  /** No easing: the reduced-motion opacity crossfades (§3). */
  linear: [0, 0, 1, 1],
} as const satisfies Record<VdMotionEaseRole | "linear", VdMotionBezier>;

/** A named role in {@link VD_MOTION_EASES_BEZIER}. */
export type VdMotionBezierRole = keyof typeof VD_MOTION_EASES_BEZIER;

/*
 * Named motion GROUPS (motion-spec-p1 §1, seconds unless noted). Each group
 * belongs to one motion moment; Orbits and Wake stay behind the
 * `motion.experiments.helmMotion` switch (default OFF) until they leave
 * prototype. No component may write these as literals.
 */

/** The Vela Dawn opening (GSAP). Total budget is a hard cap, not a target. */
export const VD_MOTION_DAWN = {
  /** Horizon light-band rise. */
  horizon: 0.18,
  /** Content reveal, overlapping the band. */
  reveal: 0.22,
  /** Per-tile stagger; total stagger stays ≤ staggerCap. */
  stagger: 0.012,
  /** The stagger budget ceiling (总错峰 ≤ 80ms, motion-spec §1/§2). */
  staggerCap: 0.08,
  /** When the tile reveal begins inside the sequence (§2: 60ms). */
  revealStart: 0.06,
  /** HARD ceiling on the whole opening — first frame to fully settled. */
  total: 0.3,
} as const;

/** Orbits zoom-out camera (GSAP; behind the helmMotion experiment). */
export const VD_MOTION_ORBIT = {
  /** Pull in/out one layer. */
  pull: 0.42,
  /** Travel between spaces along the ring. */
  travel: 0.55,
  /**
   * Parallax coefficients (NOT durations): how far front/mid/back layers
   * travel as a fraction of the camera motion.
   */
  parallax: { front: 0.06, mid: 0.12, back: 0.2 } as const,
} as const;

/** The Wake light trail (canvas overlay; behind the helmMotion experiment). */
export const VD_MOTION_WAKE = {
  /** Per-point lifetime before fading out. */
  fade: 0.45,
  /** Trail point cap (count, not a duration). */
  maxPoints: 24,
} as const;

/**
 * Wallpaper layer changes (P1): the crossfade between two PREPARED
 * backgrounds when the effective wallpaper identity changes — a space
 * switch or a light/dark mode flip. Both images are decoded before the
 * fade starts; reduced motion cuts instead.
 */
export const VD_MOTION_WALLPAPER = {
  /** Prepared-surface crossfade (both layers already decoded). */
  crossfade: 0.45,
} as const;

/** Card FLIP moments (Motion layout animations). */
export const VD_MOTION_FLIP = {
  /**
   * Reorder spring: critically damped (no overshoot) — the one place a
   * spring is allowed; everything else stays on the canonical ease.
   */
  reorder: { stiffness: 520, damping: 44, mass: 1 } as const,
  /** Tile zoom-into-sail before handing off to the browser. */
  launch: 0.26,
  /**
   * Snap-drop ripple: one 220ms ring stroke at the landing cells
   * (motion-spec-p1 §3) — opacity 0.35→0, scale 0.9→1.15, plays once per
   * drop and never under reduced motion.
   */
  dropRipple: 0.22,
  /**
   * The reduced-motion reorder downgrade: positions swap instantly, the
   * moved tiles crossfade their opacity over 120ms (§3).
   */
  reducedCrossfade: 0.12,
} as const;
