// @vitest-environment jsdom
/*
 * Task 022 — the GSAP page-pair coordinator. The suite advances the REAL
 * pair timeline (the coordinator's documented playhead seam) through
 * start/middle/end and asserts: the full-height vertical slide, the shared
 * playhead (complementary positions meeting at a viewport boundary),
 * opacity staying untouched (no crossfade), same-generation idempotence,
 * current-progress reversal retargeting, generation-guarded single
 * completion, non-participant rest, and teardown. DOM geometry is jsdom —
 * viewportHeight is an explicit mocked input, never a browser measurement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gsap } from "@components/vd/gsap";
import {
  createSectionPairCoordinator,
  type SectionPairCoordinator,
} from "./section-pair-animator";

const H = 480; // explicit test viewport metrics — NOT a browser measurement
const GEN = 7;

function makeLayer(id: string): HTMLElement {
  const element = document.createElement("section");
  element.dataset.pageId = id;
  document.body.appendChild(element);
  return element;
}

function yOf(element: HTMLElement): number {
  return Number(gsap.getProperty(element, "y"));
}

let coordinator: SectionPairCoordinator;
let incoming: HTMLElement;
let outgoing: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  coordinator = createSectionPairCoordinator();
  incoming = makeLayer("b");
  outgoing = makeLayer("a");
  coordinator.registerLayer("a", outgoing);
  coordinator.registerLayer("b", incoming);
});

afterEach(() => {
  coordinator.dispose();
});

function nextCommand(generation = GEN) {
  return {
    generation,
    incomingId: "b",
    outgoingId: "a",
    direction: "next" as const,
    enterFromOffset: true,
    viewportHeight: H,
  };
}

describe("fresh pair transition (022)", () => {
  it("commits the entry pose synchronously and slides the full viewport height", () => {
    coordinator.apply(nextCommand(), vi.fn());
    // Pre-paint contract: the incoming page's FIRST committed frame is the
    // entry pose (fromTo immediateRender inside the caller's layout phase).
    expect(yOf(incoming)).toBe(H);
    expect(yOf(outgoing)).toBe(0);

    coordinator.currentTimeline()!.progress(1);
    expect(yOf(incoming)).toBe(0);
    expect(yOf(outgoing)).toBe(-H);
  });

  it("shares ONE playhead: the pair always meets at a moving viewport boundary", () => {
    coordinator.apply(nextCommand(), vi.fn());
    const timeline = coordinator.currentTimeline()!;
    for (const progress of [0.25, 0.5, 0.75]) {
      timeline.progress(progress);
      // Complementary positions: incomingY − outgoingY === H at every
      // instant — their visible regions meet at the moving boundary.
      expect(yOf(incoming) - yOf(outgoing)).toBeCloseTo(H, 4);
    }
    timeline.progress(1);
    expect(yOf(incoming) - yOf(outgoing)).toBeCloseTo(H, 4);
  });

  it("animates transform ONLY — opacity is never written (no crossfade)", () => {
    coordinator.apply(nextCommand(), vi.fn());
    expect(incoming.style.opacity).toBe("");
    expect(outgoing.style.opacity).toBe("");
    coordinator.currentTimeline()!.progress(0.5);
    expect(incoming.style.opacity).toBe("");
    expect(outgoing.style.opacity).toBe("");
  });

  it("runs on the canonical sectionPage preset (0.5s, power2.out)", () => {
    coordinator.apply(nextCommand(), vi.fn());
    const timeline = coordinator.currentTimeline()!;
    expect(timeline.duration()).toBeCloseTo(0.5, 5);
    const tweens = timeline.getChildren(false, true, true);
    expect(tweens).toHaveLength(2);
    for (const tween of tweens) {
      expect((tween as gsap.core.Tween).vars.ease).toBe("power2.out");
    }
  });

  it("mirrors the signs for previous-page navigation", () => {
    coordinator.apply({ ...nextCommand(), direction: "prev" }, vi.fn());
    expect(yOf(incoming)).toBe(-H);
    coordinator.currentTimeline()!.progress(1);
    expect(yOf(incoming)).toBe(0);
    expect(yOf(outgoing)).toBe(H);
  });

  it("reports exactly one settle for the pair, with the outgoing id and generation", () => {
    const onSettled = vi.fn();
    coordinator.apply(nextCommand(), onSettled);
    expect(onSettled).not.toHaveBeenCalled();
    coordinator.currentTimeline()!.progress(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith("a", GEN);
    expect(coordinator.isTransitioning()).toBe(false);
  });
});

describe("idempotence and interruption (022)", () => {
  it("an identical re-apply (same generation) never restarts the playhead", () => {
    coordinator.apply(nextCommand(), vi.fn());
    const timeline = coordinator.currentTimeline()!;
    timeline.progress(0.3);
    const before = yOf(incoming);
    coordinator.apply(nextCommand(), vi.fn()); // unrelated shell rerender
    // The live timeline survived: same instance, playhead position kept.
    expect(coordinator.currentTimeline()!).toBe(timeline);
    expect(yOf(incoming)).toBe(before);
    expect(timeline.progress()).toBeCloseTo(0.3, 5);
    expect(coordinator.isTransitioning()).toBe(true);
  });

  it("a reversal retargets BOTH layers from current progress, never the entry pose", () => {
    coordinator.apply(nextCommand(), vi.fn());
    coordinator.currentTimeline()!.progress(0.5);
    const incomingMid = yOf(incoming); // mid-slide, descending
    const outgoingMid = yOf(outgoing);
    expect(incomingMid).toBeGreaterThan(0);
    expect(outgoingMid).toBeLessThan(0);

    // A→B→A: the pair flips — old outgoing becomes the incoming, and the
    // entry offset must NOT be reapplied.
    coordinator.apply(
      {
        generation: GEN + 1,
        incomingId: "a",
        outgoingId: "b",
        direction: "prev",
        enterFromOffset: false,
        viewportHeight: H,
      },
      vi.fn(),
    );
    // Killing the old timeline preserved the interrupted poses, and the
    // new tweens' origins are those values — no reset to entry offsets.
    expect(yOf(incoming)).toBeCloseTo(incomingMid, 3);
    expect(yOf(outgoing)).toBeCloseTo(outgoingMid, 3);
    const fresh = coordinator.currentTimeline()!;
    fresh.progress(0);
    expect(yOf(incoming)).toBeCloseTo(incomingMid, 3);
    expect(yOf(outgoing)).toBeCloseTo(outgoingMid, 3);

    fresh.progress(1);
    // "a" (the page that was exiting) returns to rest; "b" (the page that
    // was entering) slides away to the previous-direction exit offset.
    expect(yOf(outgoing)).toBe(0);
    expect(yOf(incoming)).toBe(H);
  });

  it("a newer command supersedes the running one — only its completion settles", () => {
    const stale = vi.fn();
    const current = vi.fn();
    coordinator.apply(nextCommand(GEN), stale);
    coordinator.apply(nextCommand(GEN + 1), current);
    // The stale pair's completion can never fire (its timeline was killed).
    expect(stale).not.toHaveBeenCalled();
    coordinator.currentTimeline()!.progress(1);
    expect(current).toHaveBeenCalledTimes(1);
    expect(current).toHaveBeenCalledWith("a", GEN + 1);
    expect(coordinator.isTransitioning()).toBe(false);
  });

  it("rests non-participant layers when a new pair takes over", () => {
    const third = makeLayer("c");
    coordinator.registerLayer("c", third);
    gsap.set(third, { y: 120 }); // a stale pose from an older transition
    coordinator.apply(nextCommand(), vi.fn());
    expect(yOf(third)).toBe(0);
  });
});

describe("settle and teardown (022)", () => {
  it("settleAll rests every layer and stops the transition", () => {
    coordinator.apply(nextCommand(), vi.fn());
    coordinator.currentTimeline()!.progress(0.4);
    coordinator.settleAll();
    expect(coordinator.isTransitioning()).toBe(false);
    expect(yOf(incoming)).toBe(0);
    expect(yOf(outgoing)).toBe(0);
  });

  it("a completion after dispose never fires", () => {
    const onSettled = vi.fn();
    coordinator.apply(nextCommand(), onSettled);
    coordinator.dispose();
    expect(onSettled).not.toHaveBeenCalled();
    expect(coordinator.isTransitioning()).toBe(false);
  });

  it("apply after dispose is a no-op", () => {
    coordinator.dispose();
    coordinator.apply(nextCommand(), vi.fn());
    expect(coordinator.isTransitioning()).toBe(false);
  });
});
