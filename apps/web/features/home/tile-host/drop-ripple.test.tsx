// @vitest-environment jsdom
/*
 * The snap-drop ripple (P1, motion-spec §3): the landing cells derive
 * from the committed placement (every item whose cell CHANGED), the
 * session never records anything under reduced motion, and the layer
 * renders one ring per recorded box positioned from the shared grid
 * metrics.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { PagePlacement } from "@veladesk/domain";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASES, VD_MOTION_EASES_BEZIER, VD_MOTION_FLIP } from "@components/vd/motion-tokens";
import { DROP_RIPPLE_EASE, snapDropBoxes, SnapDropRipples, useSnapDropRipples } from "./drop-ripple";

type GridItem = { id: string; column: number; row: number; columnSpan: number; rowSpan: number };

function gridPlacement(items: readonly GridItem[]): PagePlacement {
  return {
    version: 2,
    mode: "grid",
    columns: 6,
    items: items.map((item) => ({ ...item })),
  } as PagePlacement;
}

const START = gridPlacement([
  { id: "a", column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
  { id: "b", column: 2, row: 0, columnSpan: 2, rowSpan: 1 },
]);

function installMatchMedia(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") && reduced,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

/** Renders the hook through a probe that mirrors its LATEST session. */
function mountSessionProbe(reduced: boolean): {
  session: () => ReturnType<typeof useSnapDropRipples>;
} {
  installMatchMedia(reduced);
  const holder: { session: ReturnType<typeof useSnapDropRipples> | null } = { session: null };
  function Probe() {
    const session = useSnapDropRipples();
    holder.session = session;
    return null;
  }
  render(<Probe />);
  expect(holder.session).not.toBeNull();
  return { session: () => holder.session! };
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("snapDropBoxes", () => {
  it("derives the landing cells of every moved item", () => {
    const moved = gridPlacement([
      { id: "a", column: 0, row: 2, columnSpan: 1, rowSpan: 1 },
      { id: "b", column: 2, row: 0, columnSpan: 2, rowSpan: 1 },
    ]);
    expect(snapDropBoxes(moved, START)).toEqual([
      { column: 0, row: 2, columnSpan: 1, rowSpan: 1 },
    ]);
  });

  it("is empty for unchanged placements and freeform modes", () => {
    expect(snapDropBoxes(START, START)).toEqual([]);
    const freeform = {
      mode: "freeform",
      items: [{ id: "a", rect: { x: 0, y: 0, width: 10, height: 10 } }],
    } as unknown as PagePlacement;
    expect(snapDropBoxes(freeform, freeform)).toEqual([]);
  });
});

describe("useSnapDropRipples", () => {
  it("records played ripples (no-op drop records nothing)", () => {
    const { session } = mountSessionProbe(false);
    expect(session().ripples).toEqual([]);
    act(() => {
      session().playSnapDrop(
        gridPlacement([{ id: "a", column: 3, row: 3, columnSpan: 1, rowSpan: 1 }]),
        START,
      );
    });
    expect(session().ripples.length).toBe(1);
    expect(session().ripples[0]!.box).toEqual({
      column: 3,
      row: 3,
      columnSpan: 1,
      rowSpan: 1,
    });
    // A committed placement identical to its start: no ripple.
    act(() => {
      session().playSnapDrop(START, START);
    });
    expect(session().ripples.length).toBe(1);
  });

  it("never records a freeform (free layout) drop", () => {
    const { session } = mountSessionProbe(false);
    const freeformStart = {
      mode: "freeform",
      items: [{ id: "a", rect: { x: 0, y: 0, width: 10, height: 10 } }],
    } as unknown as PagePlacement;
    const freeformMoved = {
      mode: "freeform",
      items: [{ id: "a", rect: { x: 40, y: 40, width: 10, height: 10 } }],
    } as unknown as PagePlacement;
    act(() => {
      session().playSnapDrop(freeformMoved, freeformStart);
    });
    expect(session().ripples).toEqual([]);
  });

  it("retires a ring after the stroke plus its tail token, not before", () => {
    vi.useFakeTimers();
    try {
      const { session } = mountSessionProbe(false);
      act(() => {
        session().playSnapDrop(
          gridPlacement([{ id: "a", column: 3, row: 3, columnSpan: 1, rowSpan: 1 }]),
          START,
        );
      });
      const retireMs = (VD_MOTION_FLIP.dropRipple + VD_MOTION_FLIP.dropRippleTail) * 1000;
      act(() => {
        vi.advanceTimersByTime(retireMs - 5);
      });
      expect(session().ripples.length).toBe(1);
      act(() => {
        vi.advanceTimersByTime(10);
      });
      expect(session().ripples).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never records under reduced motion", () => {
    const { session } = mountSessionProbe(true);
    act(() => {
      session().playSnapDrop(
        gridPlacement([{ id: "a", column: 3, row: 3, columnSpan: 1, rowSpan: 1 }]),
        START,
      );
    });
    expect(session().ripples).toEqual([]);
  });
});

describe("SnapDropRipples layer", () => {
  it("renders one ring per box at the shared grid metrics", () => {
    const { container } = render(
      <SnapDropRipples
        ripples={[
          { id: 1, box: { column: 2, row: 1, columnSpan: 2, rowSpan: 1 } },
          { id: 2, box: { column: 0, row: 3, columnSpan: 1, rowSpan: 2 } },
        ]}
        cellPx={100}
        gapPx={20}
      />,
    );
    const rings = container.querySelectorAll(".vela-drop-ripple");
    expect(rings.length).toBe(2);
    const first = rings[0] as HTMLElement;
    expect(first.style.left).toBe("240px");
    expect(first.style.top).toBe("120px");
    expect(first.style.width).toBe("220px");
    expect(first.style.height).toBe("100px");
    expect(first.getAttribute("data-motion-owner")).toBe("motion");
  });

  it("renders nothing for an empty session", () => {
    const { container } = render(<SnapDropRipples ripples={[]} cellPx={100} gapPx={20} />);
    expect(container.querySelector(".vela-drop-ripple-layer")).toBeNull();
  });
});

/** Evaluates a CSS cubic-bezier at x (bisection on the x polynomial). */
function bezierAt(curve: readonly [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = curve;
  const axis = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2;
    if (axis(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return axis((lo + hi) / 2, y1, y2);
}

describe("drop ripple easing", () => {
  it("rides the standard bezier token (no literal curve)", () => {
    expect(DROP_RIPPLE_EASE).toBe(VD_MOTION_EASES_BEZIER.standard);
  });

  it("the bezier twins track their GSAP curves closely", () => {
    for (const role of Object.keys(VD_MOTION_EASES) as (keyof typeof VD_MOTION_EASES)[]) {
      const gsapCurve = gsap.parseEase(VD_MOTION_EASES[role]);
      for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        expect(
          Math.abs(bezierAt(VD_MOTION_EASES_BEZIER[role], x) - gsapCurve(x)),
          `${role} at ${x}`,
        ).toBeLessThan(0.03);
      }
    }
  });
});
