// @vitest-environment jsdom
/*
 * Task 022 — VdAnimatedSurface contracts: synchronous initial pose, one
 * retargetable tween per direction, exactly-one presence release on exit
 * completion, reopen-mid-exit continuation (no snap, no release), and the
 * reduced-motion instant-settle path (stubbed matchMedia — jsdom has
 * none).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { gsap } from "./gsap";
import { VdAnimatedSurface, VdPopupSurface } from "./animated-surface";

function surfaceTween(el: HTMLElement): gsap.core.Tween | undefined {
  return gsap.getTweensOf(el)[0];
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VdAnimatedSurface", () => {
  it("applies the hidden pose synchronously on a fresh entrance (before any tick)", () => {
    const { getByTestId } = render(
      <VdAnimatedSurface active={true} variant="dialog" data-testid="surface" />
    );
    const el = getByTestId("surface") as HTMLElement;
    // The enter tween's first tick hasn't run — the committed pose IS the
    // entrance start pose (dialog: opacity 0, y 8, scale 0.985).
    expect(el.style.opacity).toBe("0");
    expect(el.style.transform).toContain("8px");
  });

  it("animates to the resting pose along one owned tween", () => {
    const { getByTestId } = render(
      <VdAnimatedSurface active={true} variant="dialog" data-testid="surface" />
    );
    const el = getByTestId("surface") as HTMLElement;
    const tweens = gsap.getTweensOf(el);
    expect(tweens).toHaveLength(1);
    tweens[0]!.progress(1);
    expect(el.style.opacity).toBe("1");
    expect(tweens[0]!.duration()).toBeCloseTo(0.34, 5);
  });

  it("plays an exit on close and releases presence exactly once at completion", () => {
    const onReleased = vi.fn();
    const view = render(
      <VdAnimatedSurface
        active={true}
        variant="dialog"
        data-testid="surface"
        onPresenceReleased={onReleased}
      />
    );
    const el = view.getByTestId("surface") as HTMLElement;
    view.rerender(
      <VdAnimatedSurface
        active={false}
        variant="dialog"
        data-testid="surface"
        onPresenceReleased={onReleased}
      />
    );
    // While the exit runs the surface is pointer-inert…
    expect(el.style.pointerEvents).toBe("none");
    expect(onReleased).not.toHaveBeenCalled();
    const exit = surfaceTween(el)!;
    expect(exit.duration()).toBeCloseTo(0.34 * 0.75, 5);
    exit.progress(1);
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it("re-opening mid-exit retargets the same surface without releasing presence", () => {
    const onReleased = vi.fn();
    const view = render(
      <VdAnimatedSurface
        active={true}
        variant="panel"
        data-testid="surface"
        onPresenceReleased={onReleased}
      />
    );
    const el = view.getByTestId("surface") as HTMLElement;
    // Let the entrance settle first (the enter tween records its start on
    // its first render; the test must advance it before closing).
    surfaceTween(el)!.progress(1);
    view.rerender(
      <VdAnimatedSurface
        active={false}
        variant="panel"
        data-testid="surface"
        onPresenceReleased={onReleased}
      />
    );
    const exit = surfaceTween(el)!;
    exit.progress(0.6); // mid-exit: partially visible
    const midOpacity = Number.parseFloat(el.style.opacity);
    expect(midOpacity).toBeGreaterThan(0);
    expect(midOpacity).toBeLessThan(1);

    view.rerender(
      <VdAnimatedSurface
        active={true}
        variant="panel"
        data-testid="surface"
        onPresenceReleased={onReleased}
      />
    );
    expect(el.style.pointerEvents).toBe("");
    const enter = surfaceTween(el)!;
    // The retargeted enter must continue FROM the current values, not from
    // the hidden pose: rendering its own start frame reproduces the
    // mid-exit opacity, not 0.
    enter.progress(0);
    expect(Number.parseFloat(el.style.opacity)).toBeCloseTo(midOpacity, 2);
    enter.progress(1);
    expect(el.style.opacity).toBe("1");
    expect(onReleased).not.toHaveBeenCalled();
  });

  it("the overlay variant animates opacity only", () => {
    const { getByTestId } = render(
      <VdAnimatedSurface active={true} variant="overlay" data-testid="surface" />
    );
    const el = getByTestId("surface") as HTMLElement;
    expect(el.style.opacity).toBe("0");
    surfaceTween(el)!.progress(1);
    expect(el.style.opacity).toBe("1");
  });

  it("the editor window follows the t171 spec (240ms in from scale 0.96, 160ms out to 0.98)", () => {
    const view = render(
      <VdAnimatedSurface active={true} variant="editor" data-testid="surface" />
    );
    const el = view.getByTestId("surface") as HTMLElement;
    // The committed start pose: scale 0.96 + 8px rise + opacity 0.
    expect(el.style.opacity).toBe("0");
    expect(el.style.transform).toContain("8px");
    expect(el.style.transform).toContain("0.96");
    const enter = surfaceTween(el)!;
    expect(enter.duration()).toBeCloseTo(0.24, 5);
    enter.progress(1);
    expect(el.style.opacity).toBe("1");

    view.rerender(<VdAnimatedSurface active={false} variant="editor" data-testid="surface" />);
    const exit = surfaceTween(el)!;
    expect(exit.duration()).toBeCloseTo(0.16, 5);
    // The leave lands on the shallower 0.98 scale, not the 0.96 origin.
    expect(exit.vars.scale).toBe(0.98);
  });

  it("the sheet pose slides the full height (t171: 280ms in, 200ms out, no scale travel)", () => {
    const view = render(
      <VdAnimatedSurface active={true} variant="sheet" data-testid="surface" />
    );
    const el = view.getByTestId("surface") as HTMLElement;
    const enter = surfaceTween(el)!;
    expect(enter.duration()).toBeCloseTo(0.28, 5);
    // The slide is translation-only: scale stays at the identity.
    expect(enter.vars.scale).toBe(1);

    view.rerender(<VdAnimatedSurface active={false} variant="sheet" data-testid="surface" />);
    const exit = surfaceTween(el)!;
    expect(exit.duration()).toBeCloseTo(0.2, 5);
    // The leave never touches scale either.
    expect(exit.vars.scale).toBeUndefined();
  });

  it("reduced motion settles instantly and releases an exit immediately", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mql = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    };
    (window as { matchMedia?: unknown }).matchMedia = () => mql;

    try {
      const onReleased = vi.fn();
      const view = render(
        <VdAnimatedSurface
          active={true}
          variant="dialog"
          data-testid="surface"
          onPresenceReleased={onReleased}
        />
      );
      const el = view.getByTestId("surface") as HTMLElement;
      // Settled immediately, no tween started.
      expect(el.style.opacity).toBe("1");
      expect(gsap.getTweensOf(el)).toHaveLength(0);

      view.rerender(
        <VdAnimatedSurface
          active={false}
          variant="dialog"
          data-testid="surface"
          onPresenceReleased={onReleased}
        />
      );
      expect(onReleased).toHaveBeenCalledTimes(1);
      expect(gsap.getTweensOf(el)).toHaveLength(0);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe("VdPopupSurface", () => {
  it("starts hidden and settles in along one mount tween", () => {
    const { getByTestId } = render(
      <VdPopupSurface variant="popup" data-testid="surface" />
    );
    const el = getByTestId("surface") as HTMLElement;
    expect(el.style.opacity).toBe("0");
    const tween = gsap.getTweensOf(el)[0]!;
    expect(tween.duration()).toBeCloseTo(0.24, 5);
    tween.progress(1);
    expect(el.style.opacity).toBe("1");
  });
});
