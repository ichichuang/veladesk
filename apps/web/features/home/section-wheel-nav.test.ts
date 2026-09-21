import { describe, expect, it } from "vitest";

import {
  INITIAL_WHEEL_NAV_STATE,
  WHEEL_NAV_THRESHOLD_PX,
  advanceWheelNav,
  unlockWheelNav,
} from "./section-wheel-nav";

describe("advanceWheelNav — one section per gesture", () => {
  it("accumulates small deltas until the threshold is crossed", () => {
    let state = INITIAL_WHEEL_NAV_STATE;

    // A high-resolution trackpad sends many tiny deltas.
    for (let index = 0; index < 11; index += 1) {
      const result = advanceWheelNav(state, 4);
      expect(result.action).toBeNull();
      state = result.state;
    }
    // 44px accumulated — still below the 48px threshold.
    expect(state.accumulated).toBe(44);

    const crossed = advanceWheelNav(state, 4);
    expect(crossed.action).toBe("next");
    expect(crossed.state).toEqual({ accumulated: 0, locked: true });
  });

  it("locks for the rest of the gesture — a burst of events fires once", () => {
    const first = advanceWheelNav(INITIAL_WHEEL_NAV_STATE, 120);
    expect(first.action).toBe("next");
    expect(first.state.locked).toBe(true);

    // The rest of the same trackpad glide changes nothing.
    for (const delta of [80, 60, 40, 120, -30]) {
      const result = advanceWheelNav(first.state, delta);
      expect(result.action).toBeNull();
      expect(result.state).toBe(first.state);
    }
  });

  it("navigates up on negative deltas", () => {
    const result = advanceWheelNav(INITIAL_WHEEL_NAV_STATE, -60);
    expect(result.action).toBe("prev");
  });

  it("lets small jitters in both directions cancel out", () => {
    let state = INITIAL_WHEEL_NAV_STATE;
    state = advanceWheelNav(state, 20).state;
    state = advanceWheelNav(state, -20).state;
    expect(state.accumulated).toBe(0);
    expect(state.locked).toBe(false);
  });

  it("ignores non-finite input", () => {
    const result = advanceWheelNav(INITIAL_WHEEL_NAV_STATE, Number.NaN);
    expect(result.action).toBeNull();
    expect(result.state).toBe(INITIAL_WHEEL_NAV_STATE);
  });

  it("unlocks through the inactivity reset only", () => {
    const locked = advanceWheelNav(INITIAL_WHEEL_NAV_STATE, 120).state;
    expect(unlockWheelNav(locked)).toEqual(INITIAL_WHEEL_NAV_STATE);
    expect(unlockWheelNav(INITIAL_WHEEL_NAV_STATE)).toBe(INITIAL_WHEEL_NAV_STATE);
    expect(WHEEL_NAV_THRESHOLD_PX).toBeGreaterThan(0);
  });
});
