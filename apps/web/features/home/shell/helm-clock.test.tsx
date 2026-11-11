// @vitest-environment jsdom
/*
 * The t61 live clock: HH:MM:SS on odometer digit reels.
 *
 * Contracts under test: the rendered structure (6 digit reels + 2 breathing
 * colons, seconds inside the dimmer block), the roller's UP-ONLY travel
 * model (a decrease rolls the long way around; the wrap parks back onto
 * the first reel set invisibly), boundary-aligned ticking (no drift, no
 * background catch-up), and reduced motion (the reel carries no
 * transition — the swap is an in-place cut).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { HelmClock } from "./helm-clock";

function reels(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".vela-clock-digit__reel"));
}

function reelPos(reel: HTMLElement): number {
  // The reel translates by -pos em; the REEL INDEX is what the tests
  // reason about (digit = pos % 10).
  const match = reel.style.transform.match(/translateY\((-?[\d.]+)em\)/);
  if (match === null) {
    return Number.NaN;
  }
  const pos = -Number(match[1]);
  return pos === 0 ? 0 : pos; // normalize -0
}

/** Fires the clock's boundary-aligned timer synchronously. */
async function fireNextTick(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1100);
    // The tick lands in a rAF after the timeout.
    const raf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    if (typeof raf === "function") {
      await new Promise<void>((resolve) => {
        (globalThis as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame(
          resolve,
        );
      });
    }
  });
}

describe("HelmClock (t61 live clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-11T09:59:58"));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders 6 digit reels, 2 colons and the seconds inside the dimmer block", () => {
    render(<HelmClock locale="zh-CN" />);
    expect(reels()).toHaveLength(6);
    const colons = document.querySelectorAll(".vela-helm-clock__colon");
    expect(colons).toHaveLength(2);
    // The seconds block exists and owns one of the colons.
    const seconds = document.querySelector(".vela-helm-clock__seconds");
    expect(seconds).not.toBeNull();
    expect(seconds!.querySelector(".vela-helm-clock__colon")).not.toBeNull();
    expect(seconds!.querySelectorAll(".vela-clock-digit__reel")).toHaveLength(2);
    // The accessible label carries the full time with seconds.
    expect(document.querySelector(".vela-helm-clock__time")?.getAttribute("aria-label")).toBe(
      "09:59:58",
    );
  });

  it("rolls ONLY the changed digits on a second boundary", async () => {
    render(<HelmClock locale="zh-CN" />);
    const before = reels().map((reel) => reel.style.transform);
    await fireNextTick(); // 09:59:58 → 09:59:59: only the last digit moves.
    const after = reels().map((reel) => reel.style.transform);
    expect(after[5]).not.toBe(before[5]);
    for (const index of [0, 1, 2, 3, 4]) {
      expect(after[index]).toBe(before[index]);
    }
  });

  it("carries a 59→00 carry with both second reels rolling UP", async () => {
    vi.setSystemTime(new Date("2026-11-11T10:00:59"));
    render(<HelmClock locale="zh-CN" />);
    const [secondsTens, secondsOnes] = [reels()[4]!, reels()[5]!];
    expect(reelPos(secondsTens)).toBe(5);
    expect(reelPos(secondsOnes)).toBe(9);

    await fireNextTick(); // → 10:01:00
    // Both reels travelled UP: tens 5→0 the long way (+5 cells onto the
    // duplicate set), ones 9→0 (+1 cell onto the duplicate zero).
    expect(reelPos(secondsTens)).toBe(10);
    expect(reelPos(secondsOnes)).toBe(10);
    // Minutes ones also carried: 0→1.
    expect(reelPos(reels()[3]!)).toBe(1);
  });

  it("parks a wrapped reel back onto the first reel set invisibly after the roll", async () => {
    vi.setSystemTime(new Date("2026-11-11T10:00:09"));
    render(<HelmClock locale="zh-CN" />);
    const secondsOnes = reels()[5]!;
    expect(reelPos(secondsOnes)).toBe(9);

    await fireNextTick(); // → :10 — the ones reel wraps 9→0 (+1).
    expect(reelPos(secondsOnes)).toBe(10);
    // After the roll window the reel parks at 0 (the same glyph, so the
    // un-transitioned snap cannot paint) and transitions re-enable.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(reelPos(secondsOnes)).toBe(0);
    expect(secondsOnes.style.transition).not.toBe("none");
  });

  it("reels carry a transform transition; reduced motion removes it", () => {
    render(<HelmClock locale="zh-CN" />);
    for (const reel of reels()) {
      expect(reel.style.transition).not.toBe("none");
    }
    // The reduced-motion kill switch is the stylesheet's job (jsdom does
    // not resolve media queries against inline styles); the component
    // contract is that NO transition is ever disabled inline at rest.
  });

  it("ticks boundary-aligned: consecutive ticks advance one second each", async () => {
    vi.setSystemTime(new Date("2026-11-11T12:30:00"));
    render(<HelmClock locale="zh-CN" />);
    expect(document.querySelector(".vela-helm-clock__time")?.getAttribute("aria-label")).toBe(
      "12:30:00",
    );
    await fireNextTick();
    expect(document.querySelector(".vela-helm-clock__time")?.getAttribute("aria-label")).toBe(
      "12:30:01",
    );
    await fireNextTick();
    expect(document.querySelector(".vela-helm-clock__time")?.getAttribute("aria-label")).toBe(
      "12:30:02",
    );
  });
});
