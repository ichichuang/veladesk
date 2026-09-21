/**
 * Pure left-rail wheel navigation accumulator (task 017).
 *
 * Wheel input over the left rail means previous/next section — but one
 * intentional gesture (a wheel flick or a two-finger trackpad scroll)
 * produces MANY wheel events, and it must change AT MOST one section.
 *
 * The accumulator sums signed deltaY until a threshold is crossed; the
 * crossing fires exactly one next/prev action and locks. The lock releases
 * only through an inactivity reset (the caller restarts a short timer on
 * every event and calls {@link unlockWheelNav} when it fires), never on
 * every event. Pure state math — no DOM, no timers in here.
 */

/** deltaY magnitude that counts as one intentional gesture. */
export const WHEEL_NAV_THRESHOLD_PX = 48;

export type WheelNavAction = "next" | "prev" | null;

export interface WheelNavState {
  readonly accumulated: number;
  readonly locked: boolean;
}

export const INITIAL_WHEEL_NAV_STATE: WheelNavState = { accumulated: 0, locked: false };

/**
 * Feed one wheel event into the accumulator.
 *
 * While locked, events are ignored entirely (the gesture is still
 * settling). Below the threshold the signed delta accumulates — small
 * jitters in both directions cancel out. Crossing the threshold fires the
 * action and re-locks for the rest of the gesture.
 */
export function advanceWheelNav(
  state: WheelNavState,
  deltaY: number,
  threshold: number = WHEEL_NAV_THRESHOLD_PX,
): { readonly state: WheelNavState; readonly action: WheelNavAction } {
  if (state.locked || !Number.isFinite(deltaY) || deltaY === 0) {
    return { state, action: null };
  }

  const accumulated = state.accumulated + deltaY;

  if (Math.abs(accumulated) < threshold) {
    return { state: { ...state, accumulated }, action: null };
  }

  return {
    state: { accumulated: 0, locked: true },
    action: accumulated > 0 ? "next" : "prev",
  };
}

/** The inactivity reset: the gesture settled, a new one may begin. */
export function unlockWheelNav(state: WheelNavState): WheelNavState {
  return state.locked || state.accumulated !== 0
    ? INITIAL_WHEEL_NAV_STATE
    : state;
}
