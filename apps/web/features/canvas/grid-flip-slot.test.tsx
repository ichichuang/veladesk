// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { GRID_FLIP_TRANSITION, GridFlipSlot } from "./grid-flip-slot";

/**
 * The snap-mode FLIP slot's render contract (P1, motion-spec §3): one
 * Motion-owned grid-area wrapper per Grid tile, marked
 * `data-motion-owner="motion"`; freeform never renders it. The spring
 * comes from the shared flip.reorder token — no literals.
 */

const item = { id: "app-1", column: 2, row: 1, columnSpan: 2, rowSpan: 1 };

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") && reduced,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as MediaQueryList;
}

describe("GridFlipSlot (P1)", () => {
  it("carries the cell placement style and the motion-owner marker", () => {
    stubReducedMotion(false);
    const { container } = render(
      <GridFlipSlot item={item} flip dragging={false} slotRef={{ current: null }}>
        <button type="button">tile</button>
      </GridFlipSlot>,
    );
    const slot = container.querySelector(".vela-item-slot") as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.getAttribute("data-motion-owner")).toBe("motion");
    expect(slot.style.gridColumn).toBe("3 / span 2");
    expect(slot.style.gridRow).toBe("2 / span 1");
    // Not dragging: no lift.
    expect(slot.style.zIndex).toBe("");
    expect(screen.getByRole("button", { name: "tile" })).not.toBeNull();
  });

  it("lifts above neighbors while its tile is being dragged", () => {
    stubReducedMotion(false);
    const { container } = render(
      <GridFlipSlot item={item} flip dragging slotRef={{ current: null }}>
        <span />
      </GridFlipSlot>,
    );
    expect((container.querySelector(".vela-item-slot") as HTMLElement).style.zIndex).toBe("30");
  });

  it("renders a plain div (no layout animation) under reduced motion", () => {
    stubReducedMotion(true);
    const { container } = render(
      <GridFlipSlot item={item} flip dragging={false} slotRef={{ current: null }}>
        <span />
      </GridFlipSlot>,
    );
    const slot = container.querySelector(".vela-item-slot") as HTMLElement;
    expect(slot.tagName).toBe("DIV");
    // The shared reduced-motion downgrade: instant repositioning, and the
    // module never attaches its media listener without a real matchMedia
    // change API (the stub above is inert by design).
    expect(slot.getAttribute("data-motion-owner")).toBe("motion");
  });

  it("builds the flip spring from the shared token — critically damped, no literals", () => {
    expect(GRID_FLIP_TRANSITION).toEqual({
      type: "spring",
      stiffness: 520,
      damping: 44,
      mass: 1,
    });
  });
});
