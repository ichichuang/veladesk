// @vitest-environment jsdom
/*
 * Task 026-R2 §16/§17/§32 — the mobile tabs indicator: HORIZONTAL geometry
 * (left/width measured once per activation, movement via transform x —
 * never per-frame layout tweens) with the width set exactly once per
 * placement. jsdom has no layout engine, so the tab geometry is injected
 * per element exactly like the desktop suites inject scroll ranges.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopPage } from "@veladesk/domain";

import { MobileCategoryTabs } from "./mobile-category-tabs";

function page(id: string, name: string): DesktopPage {
  return {
    id,
    name,
    layout: { id, grid: { columns: 4, rows: 4 }, items: [] },
  };
}

const PAGES: readonly DesktopPage[] = [page("a", "办公"), page("b", "AI"), page("c", "娱乐")];

/** Injects horizontal geometry onto the tab buttons (jsdom has none). */
function patchTabGeometry(geometries: Record<string, { left: number; width: number }>): void {
  for (const tab of screen.getAllByRole("tab")) {
    const pageId = tab.dataset.pageId!;
    const geometry = geometries[pageId];
    if (geometry === undefined) {
      continue;
    }
    Object.defineProperty(tab, "offsetLeft", { get: () => geometry.left, configurable: true });
    Object.defineProperty(tab, "offsetWidth", { get: () => geometry.width, configurable: true });
  }
}

function indicator(): HTMLElement {
  const element = document.querySelector(".vela-mobile-tabs__indicator");
  if (!(element instanceof HTMLElement)) {
    throw new Error("indicator not mounted");
  }
  return element;
}

/** Deterministic settle: let the GSAP ticker finish the indicator glide. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 700);
  });
}

afterEach(() => {
  cleanup();
});

describe("MobileCategoryTabs indicator (horizontal axis)", () => {
  it("places a VISIBLE pill: non-zero width and a horizontal transform", async () => {
    const { rerender } = render(
      <MobileCategoryTabs pages={PAGES} activePageId="a" onSelect={() => {}} />,
    );
    patchTabGeometry({ a: { left: 0, width: 80 }, b: { left: 100, width: 120 } });
    // jsdom has no layout at first paint; re-place through a real
    // deactivate→activate cycle (a real browser's first placement is this
    // same set path with live geometry).
    rerender(<MobileCategoryTabs pages={PAGES} activePageId={null} onSelect={() => {}} />);
    rerender(<MobileCategoryTabs pages={PAGES} activePageId="a" onSelect={() => {}} />);
    await settle();
    const pill = indicator();
    expect(pill.style.width).toBe("80px");
    expect(pill.style.transform).toContain("(");
    expect(pill.style.top).toBe("");
    expect(pill.style.height).toBe("");
  });

  it("GLIDES horizontally: x follows the new tab, width re-set once — no top/height writes", async () => {
    const { rerender } = render(
      <MobileCategoryTabs pages={PAGES} activePageId="a" onSelect={() => {}} />,
    );
    patchTabGeometry({ a: { left: 0, width: 80 }, b: { left: 100, width: 120 } });
    rerender(
      <MobileCategoryTabs pages={PAGES} activePageId="b" onSelect={() => {}} />,
    );
    await settle();
    const pill = indicator();
    // Width snaps to the new tab's width (one set, never tweened).
    expect(pill.style.width).toBe("120px");
    // Movement is a horizontal transform translate.
    expect(pill.style.transform).toContain("100");
    // The horizontal mode never writes the vertical layout properties.
    expect(pill.style.top).toBe("");
    expect(pill.style.height).toBe("");
  });

  it("still selects on tap", () => {
    let selected: string | null = null;
    render(
      <MobileCategoryTabs pages={PAGES} activePageId="a" onSelect={(id) => (selected = id)} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    expect(selected).toBe("b");
  });
});
