import { describe, expect, it } from "vitest";

import {
  INITIAL_PILL_WHEEL_STATE,
  INITIAL_WHEEL_NAV_STATE,
  PILL_WHEEL_DETENT_PX,
  PILL_WHEEL_GESTURE_GAP_MS,
  PILL_WHEEL_STEP_PX,
  WHEEL_GESTURE_GAP_MS,
  WHEEL_LINE_PX,
  WHEEL_MIN_STEP_INTERVAL_MS,
  WHEEL_PAGE_PX,
  WHEEL_STEP_PX,
  advancePillWheelNav,
  advanceWheelNav,
  normalizeWheelDelta,
  normalizeWheelEvent,
  resetWheelNav,
  stepSectionIndex,
} from "./section-wheel-nav";
import type { PillWheelNavState } from "./section-wheel-nav";

/**
 * Task 018 wheel-intent contracts. Traces below are recorded event
 * streams (deltaY, deltaMode, timestamp) representative of real devices —
 * synthetic, but shaped like captured mouse/trackpad input; natural
 * trackpad feel is additionally exercised in the browser suite.
 */

type Event = readonly [number, number, number];

function runTrace(
  trace: readonly Event[],
  start = INITIAL_WHEEL_NAV_STATE,
): { actions: string[]; state: ReturnType<typeof advanceWheelNav>["state"] } {
  let state = start;
  const actions: string[] = [];
  for (const [deltaY, deltaMode, timeMs] of trace) {
    const result = advanceWheelNav(state, normalizeWheelDelta(deltaY, deltaMode), timeMs);
    state = result.state;
    if (result.action !== null) {
      actions.push(result.action);
    }
  }
  return { actions, state };
}

describe("normalizeWheelDelta", () => {
  it("passes fractional pixel deltas through, clamped", () => {
    expect(normalizeWheelDelta(3.75, 0)).toBe(3.75);
    expect(normalizeWheelDelta(-0.5, 0)).toBe(-0.5);
    expect(normalizeWheelDelta(999_999, 0)).toBe(4000);
  });

  it("scales line and page deltaModes by the documented heuristics", () => {
    expect(normalizeWheelDelta(3, 1)).toBe(3 * WHEEL_LINE_PX);
    expect(normalizeWheelDelta(-2, 2)).toBe(-2 * WHEEL_PAGE_PX);
  });

  it("drops zero and non-finite input", () => {
    expect(normalizeWheelDelta(0, 0)).toBe(0);
    expect(normalizeWheelDelta(Number.NaN, 0)).toBe(0);
    expect(normalizeWheelDelta(Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});

describe("advanceWheelNav — one deliberate gesture fires one step", () => {
  it("accumulates sub-threshold pixel deltas without firing", () => {
    // High-resolution trackpad: many tiny deltas, ~10ms apart.
    const trace: Event[] = [];
    for (let index = 0; index < 10; index += 1) {
      trace.push([4.4, 0, index * 10]);
    }
    // 10 × 4.4 = 44px — still below the 48px step.
    const { actions } = runTrace(trace);
    expect(actions).toEqual([]);
  });

  it("fires exactly one step when the threshold is crossed", () => {
    const trace: Event[] = [];
    for (let index = 0; index < 12; index += 1) {
      trace.push([4.4, 0, index * 10]);
    }
    // 12 × 4.4 = 52.8 ≥ 48 → one step.
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next"]);
  });

  it("navigates up on negative deltas", () => {
    const { actions } = runTrace([
      [-12, 0, 10],
      [-12, 0, 20],
      [-12, 0, 30],
      [-12, 0, 40],
      [-12, 0, 50],
    ]);
    expect(actions).toEqual(["prev"]);
  });

  it("a single notch-mouse detent fires immediately", () => {
    const { actions } = runTrace([[100, 0, 500]]);
    expect(actions).toEqual(["next"]);
  });

  it("small counter-jitter neither reverses nor accumulates", () => {
    const trace: Event[] = [
      [20, 0, 10],
      [20, 0, 20],
      [-3, 0, 30], // jitter below the reversal epsilon
      [12, 0, 40],
    ];
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next"]); // 52px of down intent, one step
  });
});

describe("advanceWheelNav — momentum tail", () => {
  it("a trackpad flick with a long decaying tail fires exactly one step", () => {
    // Ramp up then geometric decay: the shape of a captured macOS flick.
    const magnitudes = [5, 12, 25, 40, 55, 60, 50, 42, 34, 27, 21, 16, 12, 9, 7, 5, 4, 3, 2, 1.5, 1];
    const trace: Event[] = magnitudes.map((delta, index) => [delta, 0, index * 12] as Event);
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next"]);
  });

  it("the tail swallows arbitrarily long decay without cascading", () => {
    // A real flick fires its step at the peak, THEN decays — the tail must
    // swallow everything after that one step.
    const trace: Event[] = [[50, 0, 0]];
    let magnitude = 50;
    for (let index = 1; index < 80; index += 1) {
      magnitude *= 0.88;
      trace.push([magnitude, 0, index * 12]);
    }
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next"]);
  });

  it("a flick at SLOW real-world cadence still fires exactly one step", () => {
    // Regression (browser-exposed): at ~25ms event cadence the interval
    // limiter used to fire a second step before decay-based tail arming
    // completed. The sustain gate closes that race.
    const magnitudes = [40, 55, 60, 50, 42, 34, 27, 21, 16, 12, 9, 7, 5, 4, 3];
    const trace: Event[] = magnitudes.map((delta, index) => [delta, 0, index * 25] as Event);
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next"]);
  });

  it("a detent right after a flick's tail ends still fires", () => {
    // Regression (browser-exposed): the first detent of a chained
    // deliberate sequence can land shortly after the tail's last event —
    // the reacceleration exit must restore firing credit.
    const flick = [40, 55, 60, 50, 42, 34, 27, 21];
    const trace: Event[] = flick.map((delta, index) => [delta, 0, index * 30] as Event);
    trace.push([100, 0, 7 * 30 + 40]); // tail armed; detent 40ms later
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next", "next"]);
  });

  it("a committed reversal ends the tail and pages back promptly", () => {
    // Down flick that settles into a tail, then a deliberate up push.
    const trace: Event[] = [
      [40, 0, 10],
      [45, 0, 22],
      [38, 0, 34],
      [30, 0, 46],
      [24, 0, 58], // tail now armed (3 decaying events)
      [18, 0, 70],
      [-30, 0, 82], // deliberate reversal
      [-24, 0, 94],
    ];
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next", "prev"]);
  });
});

describe("advanceWheelNav — continued deliberate input", () => {
  it("chained notch-mouse detents advance one section per detent", () => {
    const trace: Event[] = [];
    for (let index = 0; index < 4; index += 1) {
      trace.push([100, 0, 500 + index * 120]);
    }
    const { actions } = runTrace(trace);
    expect(actions).toEqual(["next", "next", "next", "next"]);
  });

  it("a sustained trackpad push pages repeatedly, rate-limited", () => {
    // Constant-magnitude push (not decaying) at trackpad cadence.
    const trace: Event[] = [];
    for (let index = 0; index < 40; index += 1) {
      trace.push([14, 0, index * 12]);
    }
    const { actions } = runTrace(trace);
    // 560px of travel → potential 11 steps; the interval limiter shapes it.
    expect(actions.length).toBeGreaterThanOrEqual(5);
    expect(actions.length).toBeLessThanOrEqual(
      Math.ceil((40 * 12) / WHEEL_MIN_STEP_INTERVAL_MS) + 1,
    );
    expect(new Set(actions)).toEqual(new Set(["next"]));
  });

  it("burst input cannot machine-gun steps inside one interval", () => {
    // Eight 120px spikes in 56ms — a hard flick's burst phase.
    const trace: Event[] = [];
    for (let index = 0; index < 8; index += 1) {
      trace.push([120, 0, index * 8]);
    }
    const { actions } = runTrace(trace);
    expect(actions.length).toBe(1);
  });

  it("a lone event 50-70ms after a step still fires (no dead zone)", () => {
    // Regression: the discrete-rhythm branch must reset the interval
    // limiter — a single reversed event landing 60ms after a step used to
    // be swallowed with no follow-up to redeem it.
    const { actions } = runTrace([
      [100, 0, 1000],
      [-100, 0, 1060],
    ]);
    expect(actions).toEqual(["next", "prev"]);
  });

  it("a pause longer than the gesture gap starts a fresh gesture", () => {
    const { actions } = runTrace([
      [100, 0, 100],
      [100, 0, 100 + WHEEL_GESTURE_GAP_MS + 80],
    ]);
    expect(actions).toEqual(["next", "next"]);
  });
});

describe("advanceWheelNav — reversal and boundaries", () => {
  it("mid-gesture reversal cancels stale intent and serves the new direction", () => {
    const { actions } = runTrace([
      [30, 0, 10],
      [30, 0, 20], // 60 down: one step fires
      [-20, 0, 30], // committed reversal
      [-20, 0, 40],
      [-14, 0, 50],
    ]);
    expect(actions).toEqual(["next", "prev"]);
  });

  it("stepSectionIndex clamps at both ends without wrapping", () => {
    expect(stepSectionIndex(0, 3, "prev")).toBeNull();
    expect(stepSectionIndex(2, 3, "next")).toBeNull();
    expect(stepSectionIndex(1, 3, "next")).toBe(2);
    expect(stepSectionIndex(1, 3, "prev")).toBe(0);
    expect(stepSectionIndex(1, 0, "next")).toBeNull();
    expect(stepSectionIndex(0, 3, null)).toBeNull();
  });

  it("resetWheelNav clears accumulated intent for overlay takeover", () => {
    const stepped = advanceWheelNav(INITIAL_WHEEL_NAV_STATE, 30, 100).state;
    expect(resetWheelNav()).toEqual(INITIAL_WHEEL_NAV_STATE);
    expect(stepped.distance).toBe(30);
  });
});

describe("normalizeWheelEvent (019-E §5)", () => {
  it("normalizes all three deltaModes deterministically", () => {
    expect(normalizeWheelEvent({ deltaY: 120, deltaMode: 0, ctrlKey: false })).toBe(120);
    expect(normalizeWheelEvent({ deltaY: 3, deltaMode: 1, ctrlKey: false })).toBe(3 * WHEEL_LINE_PX);
    expect(normalizeWheelEvent({ deltaY: 1, deltaMode: 2, ctrlKey: false })).toBe(WHEEL_PAGE_PX);
    expect(normalizeWheelEvent({ deltaY: -2, deltaMode: 1, ctrlKey: false })).toBe(
      -2 * WHEEL_LINE_PX,
    );
  });

  it("never turns a ctrl+wheel zoom gesture into navigation", () => {
    expect(normalizeWheelEvent({ deltaY: 240, deltaMode: 0, ctrlKey: true })).toBe(0);
    expect(normalizeWheelEvent({ deltaY: -999, deltaMode: 2, ctrlKey: true })).toBe(0);
  });

  it("safely ignores NaN and Infinity", () => {
    expect(normalizeWheelEvent({ deltaY: Number.NaN, deltaMode: 0, ctrlKey: false })).toBe(0);
    expect(normalizeWheelEvent({ deltaY: Number.POSITIVE_INFINITY, deltaMode: 0, ctrlKey: false })).toBe(0);
    expect(normalizeWheelEvent({ deltaY: Number.NEGATIVE_INFINITY, deltaMode: 1, ctrlKey: false })).toBe(0);
  });

  it("keeps the 019-E cadence inside the 90–120ms band", () => {
    expect(WHEEL_MIN_STEP_INTERVAL_MS).toBeGreaterThanOrEqual(90);
    expect(WHEEL_MIN_STEP_INTERVAL_MS).toBeLessThanOrEqual(120);
  });
});

describe("019-E §22 reference traces", () => {
  it("a 120px mouse detent fires exactly one next", () => {
    expect(runTrace([[120, 0, 1000]]).actions).toEqual(["next"]);
  });

  it("repeated detents with pauses fire three sequential moves", () => {
    // Timestamps start at 1000 like real event.timeStamp + timeOrigin —
    // t=0 is the state's "never" sentinel, not a real clock value.
    const trace: Event[] = [];
    for (let index = 0; index < 3; index += 1) {
      trace.push([120, 0, 1000 + index * 500]);
    }
    expect(runTrace(trace).actions).toEqual(["next", "next", "next"]);
  });

  it("small jitter 2, -1, 3, -2 never moves", () => {
    expect(
      runTrace([
        [2, 0, 1000],
        [-1, 0, 1008],
        [3, 0, 1016],
        [-2, 0, 1024],
      ]).actions,
    ).toEqual([]);
  });

  it("a trackpad active push 8, 14, 22, 35 fires the intended move", () => {
    expect(
      runTrace([
        [8, 0, 1000],
        [14, 0, 1012],
        [22, 0, 1024],
        [35, 0, 1036],
      ]).actions,
    ).toEqual(["next"]);
  });

  it("an inertia tail 35, 28, 20, 12, 7, 3 adds no further steps", () => {
    // The active push crosses the threshold at its peak; everything after
    // decays and must stay swallowed.
    const { actions } = runTrace([
      [8, 0, 1000],
      [14, 0, 1012],
      [22, 0, 1024],
      [35, 0, 1036],
      [28, 0, 1048],
      [20, 0, 1060],
      [12, 0, 1072],
      [7, 0, 1084],
      [3, 0, 1096],
    ]);
    expect(actions).toEqual(["next"]);
  });

  it("a sustained push 12, 20, 31, 44, 50… regains credit for later steps", () => {
    const magnitudes = [12, 20, 31, 44, ...Array<number>(22).fill(50)];
    const trace: Event[] = magnitudes.map((magnitude, index) => [magnitude, 0, 1000 + index * 12]);
    const actions = runTrace(trace).actions;
    expect(actions[0]).toBe("next");
    // Continued non-decaying input pages again at the cadence — at least
    // two further steps across the ~290ms sustained tail.
    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect(new Set(actions)).toEqual(new Set(["next"]));
  });

  it("an immediate strong reversal acts without waiting out the cadence", () => {
    const { actions } = runTrace([
      [8, 0, 1000],
      [14, 0, 1012],
      [22, 0, 1024],
      [35, 0, 1036],
      [-30, 0, 1048],
      [-30, 0, 1060],
    ]);
    expect(actions).toEqual(["next", "prev"]);
  });

  it("one step costs WHEEL_STEP_PX of travel in the reference detent", () => {
    expect(WHEEL_STEP_PX).toBeLessThan(120);
    expect(WHEEL_STEP_PX).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------- */
/* The pill's HOVER vertical-wheel model (t77)                               */
/* ------------------------------------------------------------------------- */

describe("advancePillWheelNav — hover vertical wheel (t77)", () => {
  function run(
    trace: readonly (readonly [number, number])[],
    start = INITIAL_PILL_WHEEL_STATE,
  ): { actions: string[]; state: PillWheelNavState } {
    let state = start;
    const actions: string[] = [];
    for (const [deltaY, timeMs] of trace) {
      const result = advancePillWheelNav(state, normalizeWheelDelta(deltaY, 0), timeMs);
      state = result.state;
      if (result.action !== null) {
        actions.push(result.action);
      }
    }
    return { actions, state };
  }

  it("fires one step past the ~50px threshold, direction down = next", () => {
    const { actions } = run([
      [20, 1000],
      [20, 1016],
      [20, 1032], // 60px accumulated → fires here
    ]);
    expect(actions).toEqual(["next"]);
  });

  it("down = next, up = prev", () => {
    const { actions } = run([
      [-30, 1000],
      [-30, 1016],
    ]);
    expect(actions).toEqual(["prev"]);
  });

  it("ten rapid small deltas fire exactly ONE switch (cooldown swallows the burst)", () => {
    const trace = Array.from({ length: 10 }, (_, index) => [10, 1000 + index * 20] as const);
    const { actions } = run(trace);
    expect(actions).toEqual(["next"]);
  });

  it("the cooldown hard-swallows the momentum tail; its residue never re-fires", () => {
    // A flick fires, then a realistically decaying tail streams on
    // (magnitudes halve every ~3 events, like recorded trackpad traces).
    const trace: Array<readonly [number, number]> = [
      [120, 1000], // fires immediately
      ...Array.from({ length: 40 }, (_, index) => [
        Math.max(1, Math.round(25 / 2 ** Math.floor(index / 3))),
        1010 + index * 20,
      ] as const),
    ];
    const { actions } = run(trace);
    expect(actions).toEqual(["next"]);
  });

  it("a fresh detent after the cooldown (and a pause) fires again", () => {
    const { actions } = run([
      [120, 1000],
      [120, 1600],
    ]);
    expect(actions).toEqual(["next", "next"]);
  });

  it("a committed reversal discards stale travel and needs fresh threshold travel", () => {
    const { actions } = run([
      [40, 1000],
      [40, 1016], // 80px? no — fires at 50px on the second event
      [-30, 4000], // fresh gesture upward after the cooldown + pause
      [-30, 4016],
    ]);
    expect(actions).toEqual(["next", "prev"]);
  });

  it("jitter around zero never fires", () => {
    const trace = Array.from({ length: 8 }, (_, index) => [(index % 2 === 0 ? 6 : -6), 1000 + index * 16] as const);
    const { actions } = run(trace);
    expect(actions).toEqual([]);
  });

  it("THREE discrete detents at a ~120ms rhythm each fire — no cooldown throttling (t81)", () => {
    // THE t81 contract: a mouse notch is one section, and consecutive
    // notches page at the user's rhythm — the t77 350ms clock cooldown is
    // gone; only the continuous gesture keeps its swallow.
    const { actions } = run([
      [120, 1000],
      [120, 1120],
      [120, 1240],
    ]);
    expect(actions).toEqual(["next", "next", "next"]);
  });

  it("sub-detent notches accumulate across gaps instead of dead-ending (t81)", () => {
    // Pixel-mode mice reporting ~30px per notch must still page — the
    // unfired travel survives the gesture gap, so notch 2 reaches the
    // threshold and fires (notch 3 starts the next accumulation).
    const { actions } = run([
      [30, 1000],
      [30, 1120],
      [30, 1240],
    ]);
    expect(actions).toEqual(["next"]);
  });

  it("a slow continuous trackpad push fires exactly once, however long", () => {
    // 30 events × 12px at a 16ms frame cadence = 360px of one sustained
    // gesture: ONE switch (t81 keeps the t77 one-gesture-one-switch rule).
    const trace = Array.from({ length: 30 }, (_, index) => [12, 1000 + index * 16] as const);
    const { actions } = run(trace);
    expect(actions).toEqual(["next"]);
  });

  it("uses the documented constants", () => {
    expect(PILL_WHEEL_STEP_PX).toBeGreaterThanOrEqual(45);
    expect(PILL_WHEEL_STEP_PX).toBeLessThanOrEqual(55);
    expect(PILL_WHEEL_DETENT_PX).toBeGreaterThanOrEqual(35);
    expect(PILL_WHEEL_DETENT_PX).toBeLessThanOrEqual(50);
    // The gesture gap sits between trackpad frame cadence (≤ ~30ms) and
    // mouse detent cadence (≥ ~60ms).
    expect(PILL_WHEEL_GESTURE_GAP_MS).toBeGreaterThanOrEqual(40);
    expect(PILL_WHEEL_GESTURE_GAP_MS).toBeLessThanOrEqual(60);
  });
});
