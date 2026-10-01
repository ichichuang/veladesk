// @vitest-environment jsdom
/*
 * Task 022 edition of the 021-R3 reduced-motion contract: the section
 * LAYER itself is always a plain section (all interpolation moved to the
 * shell-owned pair coordinator in 022), and with the reduced-motion
 * preference on the shell swaps sections instantly — the machine never
 * leaves idle, so no layer ever carries a transition pose. This file
 * stubs matchMedia before any render and asserts the layer renders
 * without transform machinery in every phase.
 */

import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { SectionLayer } from "./section-view";

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

describe("the layer is a plain section; reduced motion never animates (022)", () => {
  it("renders without pose machinery in the transition phases (the coordinator owns frames)", () => {
    const { container, rerender } = render(
      <SectionLayer page={{ id: "a", name: "A" } as never} phase="entering">
        <div>content-a</div>
      </SectionLayer>,
    );
    const layer = container.querySelector('[data-page-id="a"]') as HTMLElement;
    expect(layer).not.toBeNull();
    // The wrapper itself never carries a pose or an animation binding.
    expect(layer.style.transform).toBe("");
    expect(layer.style.opacity).toBe("");

    rerender(
      <SectionLayer page={{ id: "a", name: "A" } as never} phase="exit">
        <div>content-a</div>
      </SectionLayer>,
    );
    expect(layer.style.transform).toBe("");
    expect(layer.style.opacity).toBe("");
    // Phases are pure DOM state for the coordinator and the CSS contract.
    expect(layer.dataset.phase).toBe("exit");
    expect(layer.dataset.transitioning).toBe("true");
  });

  it("registers its element through the shell callback, in both directions", () => {
    const registered: string[] = [];
    const view = render(
      <SectionLayer
        page={{ id: "a", name: "A" } as never}
        phase="active"
        onLayerElement={(pageId, node) => {
          registered.push(node === null ? `-${pageId}` : pageId);
        }}
      >
        <div>content-a</div>
      </SectionLayer>,
    );
    // The stable ref callback attaches exactly once (no per-render churn).
    expect(registered).toEqual(["a"]);
    view.unmount();
    expect(registered[registered.length - 1]).toBe("-a");
  });
});
