// @vitest-environment jsdom
/*
 * Task 022-R2 — the section-rail selection marker regression.
 *
 * The real SectionRail (wheel/keyboard chrome inert here) and the real
 * VdAnimatedIndicator, in jsdom. Injected only at real boundaries: the
 * rows' offsetTop/offsetHeight/offsetParent (layout), a controllable
 * ResizeObserver (the observer seam), and a <style> rule giving the
 * marker parseable computed top/height (the browser always has one — the
 * stylesheet fallback the test installs is what the product's own CSS
 * provides in production).
 *
 * The covered contract: exactly one marker, bounded to the SELECTED row's
 * box (never the distance between rows, never a percent stretch over the
 * list), placed by GSAP on first entry (a set, not a sweep), gliding only
 * on category changes, re-measured when rows reorder or resize without an
 * activation change, hidden before valid geometry exists, never confused
 * with hover or focus, and never reusing obsolete geometry across
 * re-entry. DOM-emulated dimensions do not prove painted pixels — they
 * prove the DOM/style state a paint would show.
 */

import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { DesktopPage, DesktopPageId } from "@veladesk/domain";
import { SectionRail } from "./section-rail";
import { gsap } from "@components/vd/gsap";

// ---------------------------------------------------------------------------
// Boundaries: layout boxes, a controllable ResizeObserver, parseable CSS.
// ---------------------------------------------------------------------------

/** Mutable row geometry the injected getters read (the layout seam). */
const rowBox = new Map<string, { top: number; height: number }>();

class ControllableResizeObserver {
  static readonly instances: ControllableResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;
  private readonly targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    const index = ControllableResizeObserver.instances.indexOf(this);
    if (index >= 0) {
      ControllableResizeObserver.instances.splice(index, 1);
    }
  }

  fire(): void {
    const entries = [...this.targets].map(
      (target) => ({ target }) as ResizeObserverEntry,
    );
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

let savedResizeObserver: unknown;
const savedOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
const savedOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

beforeAll(() => {
  // jsdom has no scrollIntoView; the rail's reveal-scroll is not under test.
  Element.prototype.scrollIntoView = () => {};
  savedResizeObserver = globalThis.ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ControllableResizeObserver;
  // Layout seam on the PROTOTYPE: rows report geometry from the moment they
  // are created, so the indicator's placement effect (which runs inside the
  // same commit that mounts them) measures the injected boxes — exactly
  // what the browser's layout provides synchronously. jsdom resolves no
  // offsetParent (null), which the component treats as "no layout engine"
  // — in the browser the row's offsetParent is the list, its real
  // coordinate-space verification path.
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    get() {
      const id = (this as HTMLElement).dataset?.pageId;
      return id !== undefined && rowBox.has(id) ? rowBox.get(id)!.top : 0;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    get() {
      const id = (this as HTMLElement).dataset?.pageId;
      return id !== undefined && rowBox.has(id) ? rowBox.get(id)!.height : 0;
    },
    configurable: true,
  });
});

afterAll(() => {
  if (savedOffsetTop !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetTop", savedOffsetTop);
  }
  if (savedOffsetHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", savedOffsetHeight);
  }
  if (savedResizeObserver !== undefined) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = savedResizeObserver;
  }
});

afterEach(() => {
  cleanup();
  gsap.globalTimeline.clear();
  rowBox.clear();
});

function makePages(ids: readonly string[]): DesktopPage[] {
  return ids.map((id) => ({ id, name: id.toUpperCase() }) as unknown as DesktopPage);
}

function RailHarness(props: {
  readonly pages: DesktopPage[];
  readonly initialActive: DesktopPageId;
}) {
  const [active, setActive] = useState<DesktopPageId>(props.initialActive);
  return (
    <SectionRail
      pages={props.pages}
      activePageId={active}
      onSelectSection={setActive}
      onSectionContextMenu={() => {}}
      onOpenCommandMenu={() => {}}
      navigationLocked={false}
    />
  );
}

function markerOf(container: HTMLElement): HTMLElement {
  const marker = container.querySelector<HTMLElement>("[data-vd-indicator]");
  if (marker === null) {
    throw new Error("marker not mounted");
  }
  return marker;
}

function rowOf(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`.vela-rail__item[data-page-id="${id}"]`);
  if (row === null) {
    throw new Error(`row not mounted: ${id}`);
  }
  return row;
}

function markerBox(marker: HTMLElement): { top: number; height: number; opacity: number } {
  return {
    top: Number(gsap.getProperty(marker, "top")),
    height: Number(gsap.getProperty(marker, "height")),
    opacity: Number(gsap.getProperty(marker, "opacity")),
  };
}

// ---------------------------------------------------------------------------
// First entry: placement on the configured category, exactly one marker.
// ---------------------------------------------------------------------------

describe("first-entry marker placement (022-R2)", () => {
  beforeEach(() => {
    rowBox.set("page-a", { top: 10, height: 34 });
    rowBox.set("page-b", { top: 56, height: 40 });
    rowBox.set("page-c", { top: 104, height: 34 });
  });

  it("places the marker on a valid configured category other than the first row", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );

    const marker = markerOf(container);
    // Exactly ONE marker exists in the rail.
    expect(container.querySelectorAll("[data-vd-indicator]")).toHaveLength(1);
    // Bounded to the selected row's box — not the list, not a percent, not
    // the distance between rows.
    expect(markerBox(marker)).toEqual({ top: 56, height: 40, opacity: 1 });
    // First placement is a SET — no tween, so no sweep from zero or an
    // obsolete row.
    expect(gsap.getTweensOf(marker)).toHaveLength(0);
    expect(marker.style.top).toBe("56px");
    expect(marker.style.height).toBe("40px");
  });

  it("selected background, aria-current and displayed selection agree, and hover/focus never selects", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );

    expect(container.querySelectorAll('.vela-rail__item[data-active="true"]')).toHaveLength(1);
    expect(rowOf(container, "page-b").dataset.active).toBe("true");
    expect(rowOf(container, "page-b").getAttribute("aria-current")).toBe("page");
    expect(rowOf(container, "page-a").dataset.active).toBeUndefined();
    expect(rowOf(container, "page-c").getAttribute("aria-current")).toBeNull();

    fireEvent.mouseOver(rowOf(container, "page-a"));
    rowOf(container, "page-a").focus();
    expect(rowOf(container, "page-b").dataset.active).toBe("true");
    expect(rowOf(container, "page-a").dataset.active).toBeUndefined();
    expect(markerBox(markerOf(container)).top).toBe(56);
  });

  it("keeps the marker hidden before a valid row and geometry exist", () => {
    const empty = render(
      <RailHarness pages={makePages(["page-a"])} initialActive="page-gone" />,
    );
    // The active id matches no row: hidden, never a guessed first row.
    expect(markerBox(markerOf(empty.container))).toEqual({ top: 0, height: 0, opacity: 0 });

    const nullActive = render(
      <SectionRail
        pages={makePages(["page-a"])}
        activePageId={null}
        onSelectSection={() => {}}
        onSectionContextMenu={() => {}}
        onOpenCommandMenu={() => {}}
        navigationLocked={false}
      />,
    );
    expect(markerBox(markerOf(nullActive.container)).opacity).toBe(0);
  });

  it("glides on a subsequent category change, from the current valid position", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );
    const marker = markerOf(container);
    expect(markerBox(marker).top).toBe(56);

    fireEvent.click(rowOf(container, "page-c"));
    const tweens = gsap.getTweensOf(marker);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]!.duration()).toBe(0.28);
    tweens[0]!.progress(1);
    expect(markerBox(marker)).toEqual({ top: 104, height: 34, opacity: 1 });
  });
});

// ---------------------------------------------------------------------------
// Geometry changes WITHOUT an activation change (the first-entry/re-entry
// class: the layout settles after the marker was placed).
// ---------------------------------------------------------------------------

describe("marker geometry re-validation (022-R2)", () => {
  beforeEach(() => {
    rowBox.set("page-a", { top: 10, height: 34 });
    rowBox.set("page-b", { top: 56, height: 40 });
    rowBox.set("page-c", { top: 104, height: 34 });
  });

  it("re-measures the same row when rows are reordered or removed (a set, not a tween)", () => {
    const { container, rerender } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );
    const marker = markerOf(container);
    expect(markerBox(marker).top).toBe(56);

    // "page-a" removed above the active row: its box moves up. The row set
    // changed WITHOUT an activation change.
    rowBox.set("page-b", { top: 10, height: 40 });
    rerender(<RailHarness pages={makePages(["page-b", "page-c"])} initialActive="page-b" />);

    expect(gsap.getTweensOf(marker)).toHaveLength(0);
    expect(markerBox(marker)).toEqual({ top: 10, height: 40, opacity: 1 });
  });

  it("follows row and container box changes through the ResizeObserver (font swap), without React", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );
    const marker = markerOf(container);
    expect(markerBox(marker)).toEqual({ top: 56, height: 40, opacity: 1 });

    // The font swaps: the active row's height changes (no React rerender).
    rowBox.set("page-b", { top: 62, height: 52 });
    for (const observer of [...ControllableResizeObserver.instances]) {
      observer.fire();
    }
    expect(gsap.getTweensOf(marker)).toHaveLength(0);
    expect(markerBox(marker)).toEqual({ top: 62, height: 52, opacity: 1 });
  });

  it("an unchanged snapshot rerender never moves the marker nor starts a tween", () => {
    const { container, rerender } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );
    const marker = markerOf(container);

    rerender(
      <RailHarness
        pages={makePages(["page-a", "page-b", "page-c"])}
        initialActive="page-b"
      />,
    );
    expect(gsap.getTweensOf(marker)).toHaveLength(0);
    expect(markerBox(marker)).toEqual({ top: 56, height: 40, opacity: 1 });
  });

  it("a scrolled list keeps the marker glued to its row (one coordinate space)", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );
    const list = container.querySelector<HTMLElement>(".vela-rail__list")!;
    Object.defineProperty(list, "scrollHeight", { get: () => 400, configurable: true });
    Object.defineProperty(list, "clientHeight", { get: () => 120, configurable: true });
    list.scrollTop = 80;
    // offsetTop is content-space: the box does not shift with scrolling.
    expect(markerBox(markerOf(container))).toEqual({ top: 56, height: 40, opacity: 1 });
  });

  it("leaving and re-entering never reuses the previous session's geometry", () => {
    const first = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );
    expect(markerBox(markerOf(first.container)).top).toBe(56);
    first.unmount();

    // A different workspace shape on re-entry: fresh placement on the
    // CURRENT row of the CURRENT list — no stale 56/40 from before.
    rowBox.set("page-x", { top: 210, height: 30 });
    rowBox.set("page-y", { top: 260, height: 30 });
    const second = render(
      <RailHarness pages={makePages(["page-x", "page-y"])} initialActive="page-y" />,
    );
    const marker = markerOf(second.container);
    expect(markerBox(marker)).toEqual({ top: 260, height: 30, opacity: 1 });
    expect(gsap.getTweensOf(marker)).toHaveLength(0);
  });
});
