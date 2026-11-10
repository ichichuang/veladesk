// @vitest-environment jsdom
/*
 * Section rail interaction contract (Helm r3): the section switcher is
 * reachable without hover — wheel paging over the rail (the 018 intent
 * model, still intact), roving keyboard focus with BOTH axis pairs, and
 * the list's own native scrolling when the rows overflow. Pure DOM-level
 * assertions on the real SectionRail.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { DesktopPage, DesktopPageId } from "@veladesk/domain";
import { SectionRail } from "./section-rail";

function makePages(ids: readonly string[]): DesktopPage[] {
  return ids.map((id) => ({ id, name: id.toUpperCase() }) as unknown as DesktopPage);
}

function RailHarness(props: {
  readonly pages: DesktopPage[];
  readonly initialActive: DesktopPageId;
  readonly onSelect?: (pageId: DesktopPageId) => void;
}) {
  const [active, setActive] = useState<DesktopPageId>(props.initialActive);
  return (
    <SectionRail
      pages={props.pages}
      activePageId={active}
      onSelectSection={(pageId) => {
        props.onSelect?.(pageId);
        setActive(pageId);
      }}
      onSectionContextMenu={() => {}}
      onOpenCommandMenu={() => {}}
      navigationLocked={false}
    />
  );
}

function rowOf(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`.vela-rail__item[data-page-id="${id}"]`);
  if (row === null) {
    throw new Error(`row not mounted: ${id}`);
  }
  return row;
}

function wheelOver(target: Element, deltaY: number): void {
  fireEvent(
    target,
    new WheelEvent("wheel", {
      deltaY,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("section rail interaction (Helm r3)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders every section as a labelled, always-visible row", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-b" />,
    );
    const rows = [...container.querySelectorAll(".vela-rail__item")];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // The label is real text in the row — no hover, no tooltip required.
      expect(row.textContent).toMatch(/PAGE-/);
    }
    // Roving tabindex: exactly the ACTIVE row is Tab-reachable.
    expect(rowOf(container, "page-a").getAttribute("tabindex")).toBe("-1");
    expect(rowOf(container, "page-b").getAttribute("tabindex")).toBe("0");
    expect(rowOf(container, "page-b").getAttribute("aria-current")).toBe("page");
  });

  it("defaults to the vertical orientation (the right-side column)", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a"])} initialActive="page-a" />,
    );
    expect(container.querySelector(".vela-rail")?.getAttribute("data-orientation")).toBe(
      "vertical",
    );
  });

  it("pages sections on deliberate wheel input over the rail", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RailHarness
        pages={makePages(["page-a", "page-b", "page-c"])}
        initialActive="page-a"
        onSelect={onSelect}
      />,
    );
    // One deliberate step: WHEEL_STEP_PX of travel (the intent model).
    wheelOver(rowOf(container, "page-a"), 48);
    expect(onSelect).toHaveBeenCalledWith("page-b");
  });

  it("yields the wheel to the list's own scrolling when the rows overflow", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RailHarness
        pages={makePages(["page-a", "page-b"])}
        initialActive="page-a"
        onSelect={onSelect}
      />,
    );
    const list = container.querySelector<HTMLElement>(".vela-rail__list");
    expect(list).not.toBeNull();
    // Overflow seam: the list says it has its own scrolling to do.
    Object.defineProperty(list!, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(list!, "clientHeight", { value: 120, configurable: true });
    wheelOver(list!, 48);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves roving focus with both arrow pairs and jumps with Home/End", () => {
    const { container } = render(
      <RailHarness pages={makePages(["page-a", "page-b", "page-c"])} initialActive="page-a" />,
    );
    const activeRow = rowOf(container, "page-a");
    activeRow.focus();
    const list = container.querySelector(".vela-rail__list")!;
    // ArrowLeft behaves like ArrowUp on the vertical rail (one shared
    // contract — the horizontal bar consumes the same pairs).
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(rowOf(container, "page-a"));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rowOf(container, "page-b"));
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(document.activeElement).toBe(rowOf(container, "page-c"));
    fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(rowOf(container, "page-a"));
    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(rowOf(container, "page-c"));
  });

  it("activates a section on click without any hover", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RailHarness
        pages={makePages(["page-a", "page-b"])}
        initialActive="page-a"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(rowOf(container, "page-b"));
    expect(onSelect).toHaveBeenCalledWith("page-b");
  });
});
