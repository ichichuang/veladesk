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
import { snapDropBoxes, SnapDropRipples, useSnapDropRipples } from "./drop-ripple";

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
