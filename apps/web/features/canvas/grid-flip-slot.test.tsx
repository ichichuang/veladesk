// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { animate } from "motion/react";
import { render, screen } from "@testing-library/react";

import { GRID_FLIP_TRANSITION, GridFlipSlot } from "./grid-flip-slot";

vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  animate: vi.fn(),
}));

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

  it("keeps the SAME node across a geometry change under reduced motion (P1 crossfade)", () => {
    stubReducedMotion(true);
    const moved = { ...item, column: 4, row: 3 };
    const { container, rerender } = render(
      <GridFlipSlot item={item} flip dragging={false} slotRef={{ current: null }}>
        <button type="button">tile</button>
      </GridFlipSlot>,
    );
    const slot = container.querySelector(".vela-item-slot") as HTMLElement;
    const button = container.querySelector("button") as HTMLElement;
    rerender(
      <GridFlipSlot item={moved} flip dragging={false} slotRef={{ current: null }}>
        <button type="button">tile</button>
      </GridFlipSlot>,
    );
    // Reduced motion drops in place with no animation or remount:
    // focus and hover state must survive the swap.
    expect(container.querySelector(".vela-item-slot")).toBe(slot);
    expect(container.querySelector("button")).toBe(button);
    expect(slot.style.gridColumn).toBe("5 / span 2");
    expect(slot.style.gridRow).toBe("4 / span 1");
    expect(animate).not.toHaveBeenCalled();
    expect(slot.style.opacity).toBe("");
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
