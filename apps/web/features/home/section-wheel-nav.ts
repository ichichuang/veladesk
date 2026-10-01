/**
 * Pure left-rail wheel navigation intent model (task 017, rebuilt 018).
 *
 * Task 018 replaces the fixed "lock until 320 ms of silence" accumulator:
 * a locked gesture swallowed every event until a settle timer fired, so
 * continued deliberate scrolling advanced at most one section per pause —
 * and a rerender-driven listener teardown cancelled that timer entirely,
 * leaving navigation permanently locked. The v2 model below is still pure
 * state math (no DOM, no timers) but differentiates the four inputs the
 * event stream can actually distinguish:
 *
 *   1. NEW deliberate input  — a fresh event train after a real pause, or
 *      re-acceleration after decay. Fires one step per STEP_PX of travel.
 *   2. continued deliberate input — sustained, non-decaying magnitudes
 *      (a long trackpad push, repeated detents): steps keep firing, rate
 *      limited only by MIN_STEP_INTERVAL_MS.
 *   3. momentum tail — geometrically decaying magnitudes after a flick:
 *      swallowed entirely, so one flick = one step, never a cascade.
 *   4. reversal — a sign flip with real magnitude cancels stale forward
 *      intent immediately and counts toward the new direction.
 *
 * Browsers expose no reliable end-of-gesture signal; the decay/reaccel
 * thresholds are documented heuristics validated against recorded traces
 * in section-wheel-nav.test.ts, not hardware truth.
 */

/** Signed-pixel equivalents for the non-pixel deltaModes (heuristics). */
export const WHEEL_LINE_PX = 40;
export const WHEEL_PAGE_PX = 600;

/** Guard against absurd device reports; anything larger is clamped. */
const MAX_NORMALIZED_PX = 4000;

/** Travel that counts as one deliberate section step. */
export const WHEEL_STEP_PX = 48;

/**
 * Event gap that ends a gesture: after this much silence the next event
 * starts fresh (distance reset, tail cleared, direction may re-declare).
 */
export const WHEEL_GESTURE_GAP_MS = 160;

/**
 * Event gap that marks discrete-device rhythm (notch mouse): quiet enough
 * that the gesture's accumulated energy is spent, close enough that the
 * direction is still the same deliberate train. Chained detents each fire.
 */
export const WHEEL_DISCRETE_GAP_MS = 50;

/**
 * Minimum spacing between fired steps (burst input cannot machine-gun).
 * Task 019-E cadence: ~100ms keeps continued deliberate paging continuous
 * (no "one move then dead pause") without ever becoming a burst. This is a
 * STEP-EMISSION limit, not an animation duration.
 */
export const WHEEL_MIN_STEP_INTERVAL_MS = 100;

/**
 * A counter-direction event below this magnitude is jitter, not intent —
 * it neither reverses nor cancels accumulation.
 */
export const WHEEL_REVERSAL_EPSILON_PX = 6;

/** Each event at ≤ this fraction of the previous magnitude is "decaying". */
export const WHEEL_TAIL_DECAY_FACTOR = 0.92;

/** Consecutive decaying events (with fast gaps) that mark a momentum tail. */
export const WHEEL_TAIL_MIN_EVENTS = 2;

/**
 * Non-decaying events required after a fired step before the NEXT step may
 * fire inside the same continuous stream. This is what actually separates
 * "one flick" (post-peak events decay → the run never rebuilds) from "a
 * sustained deliberate push" (plateau magnitudes → the run rebuilds in a
 * few events). Decay-based tail arming alone races the interval limiter
 * at real ~25ms event cadences.
 */
export const WHEEL_SUSTAIN_EVENTS = 4;

/**
 * An event at ≥ this multiple of the previous tail magnitude is a new
 * deliberate push — the tail ends and accumulation resumes from zero.
 */
export const WHEEL_TAIL_REACCEL_FACTOR = 1.4;

export type WheelNavAction = "next" | "prev" | null;

export interface WheelNavState {
  /** Current gesture direction: 1 down/next, -1 up/prev, 0 undecided. */
  readonly direction: -1 | 0 | 1;
  /** |normalized| travel accumulated toward the next step. */
  readonly distance: number;
  /** Timestamp (ms) of the last fired step — -1e12 before the first. */
  readonly lastStepAt: number;
  /** Timestamp (ms) of the last event seen. */
  readonly lastEventAt: number;
  /** |normalized| magnitude of the previous event. */
  readonly lastMagnitude: number;
  /** True while a decaying momentum tail is being swallowed. */
  readonly tail: boolean;
  /** Consecutive decaying events observed (tail detection counter). */
  readonly tailEvents: number;
  /** Consecutive NON-decaying events since the last fired step. */
  readonly nonDecayRun: number;
}

/** Sentinel for "no step fired yet" — any real timestamp is far above it. */
const NEVER = -1e12;

export const INITIAL_WHEEL_NAV_STATE: WheelNavState = {
  direction: 0,
  distance: 0,
  lastStepAt: NEVER,
  lastEventAt: 0,
  lastMagnitude: 0,
  tail: false,
  tailEvents: 0,
  nonDecayRun: 0,
};

/**
 * Normalize one wheel event's vertical delta into signed pixels.
 *
 * `deltaMode` follows the DOM contract: 0 = pixels (already usable, still
 * fractional), 1 = lines, 2 = pages. Line/page heights are not standardized
 * by the platform — the multipliers above are the documented heuristic.
 * Non-finite values and zeros normalize to 0; magnitudes clamp at
 * {@link MAX_NORMALIZED_PX}.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 0;
  }
  let pixels = deltaY;
  if (deltaMode === 1) {
    pixels = deltaY * WHEEL_LINE_PX;
  } else if (deltaMode === 2) {
    pixels = deltaY * WHEEL_PAGE_PX;
  }
  if (!Number.isFinite(pixels)) {
    return 0;
  }
  const magnitude = Math.min(Math.abs(pixels), MAX_NORMALIZED_PX);
  return pixels < 0 ? -magnitude : magnitude;
}

/** The shape of a wheel event this module actually reads (DOM or test). */
export interface WheelEventLike {
  readonly deltaY: number;
  readonly deltaMode: number;
  /** Browser zoom gesture (ctrl+wheel / pinch) — never section navigation. */
  readonly ctrlKey: boolean;
}

/**
 * Normalize one whole wheel EVENT into signed pixels (task 019-E §5): the
 * event-facing facade over {@link normalizeWheelDelta}. A ctrl+wheel zoom
 * gesture or a non-finite delta yields 0 — "no navigation intent" — so the
 * caller can feed the result straight into the intent model without
 * re-implementing the guards. Pure.
 */
export function normalizeWheelEvent(event: WheelEventLike): number {
  if (event.ctrlKey) {
    return 0;
  }
  return normalizeWheelDelta(event.deltaY, event.deltaMode);
}

/**
 * Feed one normalized wheel event into the intent model.
 *
 * `timeMs` is a monotonic-ish timestamp (Date.now() or
 * performance.now()-derived); only differences are read.
 */
export function advanceWheelNav(
  state: WheelNavState,
  deltaY: number,
  timeMs: number,
): { readonly state: WheelNavState; readonly action: WheelNavAction } {
  if (deltaY === 0) {
    return { state, action: null };
  }
  const magnitude = Math.abs(deltaY);
  const sign: -1 | 1 = deltaY < 0 ? -1 : 1;
  const gap = timeMs - state.lastEventAt;

  let direction = state.direction;
  let distance = state.distance;
  let tail = state.tail;
  let tailEvents = state.tailEvents;
  let lastStepAt = state.lastStepAt;
  let nonDecayRun = state.nonDecayRun;

  // 1. A real pause ends the gesture entirely.
  if (state.lastEventAt !== 0 && gap > WHEEL_GESTURE_GAP_MS) {
    direction = 0;
    distance = 0;
    tail = false;
    tailEvents = 0;
    // A real pause is a new gesture: its first event may fire a step.
    nonDecayRun = WHEEL_SUSTAIN_EVENTS;
  } else if (state.lastEventAt !== 0 && gap > WHEEL_DISCRETE_GAP_MS) {
    // 2. Discrete-device rhythm: the train went quiet, then a fresh detent
    //    lands. Spend the accumulated distance; keep the direction only if
    //    the new event agrees with it. The step-interval limiter resets too —
    //    it exists to stop same-gesture machine-gunning, and a 50ms+ pause
    //    is by definition a new gesture (otherwise a lone event landing
    //    50-70ms after a step would be swallowed with no follow-up).
    distance = 0;
    tail = false;
    tailEvents = 0;
    lastStepAt = NEVER;
    nonDecayRun = WHEEL_SUSTAIN_EVENTS;
    if (direction !== 0 && sign !== direction) {
      direction = 0;
    }
  }

  // Tail bookkeeping only counts fast, decaying events — a detent after a
  // quiet gap is discrete rhythm, not decay. Arming the tail BEFORE the
  // fire check matters: the third decaying event must be swallowed, not
  // fired (the flick's step already happened at the peak).
  const decaying =
    state.lastEventAt !== 0 &&
    gap <= WHEEL_DISCRETE_GAP_MS &&
    state.lastMagnitude > 0 &&
    magnitude <= state.lastMagnitude * WHEEL_TAIL_DECAY_FACTOR;
  tailEvents = decaying ? tailEvents + 1 : 0;
  nonDecayRun = decaying ? 0 : nonDecayRun + 1;
  if (tailEvents >= WHEEL_TAIL_MIN_EVENTS) {
    tail = true;
    distance = 0;
  }

  if (tail) {
    const reaccelerated =
      state.lastMagnitude > 0 && magnitude >= state.lastMagnitude * WHEEL_TAIL_REACCEL_FACTOR;
    const reversed = sign !== direction && direction !== 0 && magnitude >= WHEEL_REVERSAL_EPSILON_PX;
    if (reaccelerated || reversed) {
      // A new deliberate push (or a committed reversal) ends the tail; the
      // push starts accumulating from this event. A reacceleration IS a
      // new push by definition, so it restores firing credit immediately —
      // without this, a detent landing shortly after a flick's tail ended
      // was swallowed by the sustain gate.
      tail = false;
      distance = 0;
      nonDecayRun = WHEEL_SUSTAIN_EVENTS;
      if (reversed) {
        direction = sign;
        lastStepAt = NEVER;
      }
    } else {
      // Momentum tail: swallow, keep timestamps current — and persist the
      // LOCAL bookkeeping (tail flag, reset distance): spreading the old
      // state here would silently un-arm the tail every event.
      return {
        state: {
          direction,
          distance,
          lastStepAt,
          lastEventAt: timeMs,
          lastMagnitude: magnitude,
          tail,
          tailEvents,
          nonDecayRun,
        },
        action: null,
      };
    }
  }

  if (direction === 0) {
    direction = sign;
  } else if (sign !== direction) {
    if (magnitude < WHEEL_REVERSAL_EPSILON_PX) {
      // Jitter against the direction: neither reverses nor accumulates.
      return {
        state: {
          direction,
          distance,
          lastStepAt,
          lastEventAt: timeMs,
          lastMagnitude: magnitude,
          tail,
          tailEvents,
          nonDecayRun,
        },
        action: null,
      };
    }
    // Committed reversal: stale forward intent dies now, and the interval
    // limiter resets with it — a reversal must respond promptly from the
    // current visual position, not wait out the opposite direction's rate
    // limit. (Alternating ±device noise cannot machine-gun: each flip
    // still needs a full STEP_PX of same-direction travel.)
    direction = sign;
    distance = 0;
    lastStepAt = NEVER;
    nonDecayRun = WHEEL_SUSTAIN_EVENTS;
  }

  distance += magnitude;

  let action: WheelNavAction = null;
  const firstStep = lastStepAt === NEVER;
  if (
    distance >= WHEEL_STEP_PX &&
    timeMs - lastStepAt >= WHEEL_MIN_STEP_INTERVAL_MS &&
    (firstStep || nonDecayRun >= WHEEL_SUSTAIN_EVENTS)
  ) {
    action = direction === 1 ? "next" : "prev";
    distance = 0;
    lastStepAt = timeMs;
    tailEvents = 0;
    nonDecayRun = 0;
  }

  return {
    state: {
      direction,
      distance,
      lastStepAt,
      lastEventAt: timeMs,
      lastMagnitude: magnitude,
      tail,
      tailEvents,
      nonDecayRun,
    },
    action,
  };
}

/**
 * Explicit intent reset — call when an overlay/gesture takes over the
 * desktop, so accumulated intent is cleared instead of replaying later.
 */
export function resetWheelNav(): WheelNavState {
  return INITIAL_WHEEL_NAV_STATE;
}

/**
 * Clamp a fired action onto the section list: no wrapping, null at the
 * ends. Pure so callers and tests share one boundary contract.
 */
export function stepSectionIndex(
  currentIndex: number,
  count: number,
  action: WheelNavAction,
): number | null {
  if (action === null || count <= 0) {
    return null;
  }
  const next = action === "next" ? currentIndex + 1 : currentIndex - 1;
  if (next < 0 || next >= count) {
    return null;
  }
  return next;
}
