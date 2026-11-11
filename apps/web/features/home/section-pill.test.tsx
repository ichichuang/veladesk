// @vitest-environment jsdom
/*
 * The t61 section pill: the glass capsule above the dock.
 *
 * Contracts under test: one segment per section with the page name (emoji
 * rides along), click switching with the sliding Motion highlight on the
 * active segment, the compact short-viewport form (name + steppers), and
 * the management entries staying reachable (context-menu key). Wheel and
 * pointer streams are covered by the real-browser suites.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { DesktopPage, DesktopPageId } from "@veladesk/domain";

import { SectionPill } from "./section-pill";

function page(id: string, name: string): DesktopPage {
  return { id, name } as DesktopPage;
}

const PAGES: readonly DesktopPage[] = [
  page("p1", "前端开发"),
  page("p2", "AI 工具 🤖"),
  page("p3", "设计灵感"),
];

function mount(
  onSelect: (id: DesktopPageId) => void = vi.fn(),
  overrides: Partial<Parameters<typeof SectionPill>[0]> = {},
) {
  return render(
    <SectionPill
      pages={PAGES}
      activePageId="p1"
      onSelectSection={onSelect}
      onSectionContextMenu={vi.fn()}
      navigationLocked={false}
      {...overrides}
    />,
  );
}

describe("SectionPill (t61)", () => {
  // jsdom has no scrollIntoView; the pill reveals the active segment with it.
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => cleanup());

  it("renders one segment per section with the full name (emoji included)", () => {
    const { container } = mount();
    const segments = container.querySelectorAll(".vela-pill__item");
    expect(segments).toHaveLength(3);
    expect(segments[1]!.textContent).toContain("AI 工具 🤖");
  });

  it("marks exactly the active segment (aria-current) and mounts the highlight inside it", () => {
    const { container } = mount();
    const active = container.querySelectorAll('.vela-pill__item[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]!.getAttribute("aria-current")).toBe("page");
    expect(active[0]!.querySelector(".vela-pill__highlight")).not.toBeNull();
    // Roving tabindex: the active segment is the tab stop.
    expect((active[0]! as HTMLButtonElement).tabIndex).toBe(0);
  });

  it("clicking a segment switches sections (no hover needed)", () => {
    const onSelect = vi.fn();
    const { container } = mount(onSelect);
    fireEvent.click(
      container.querySelectorAll(".vela-pill__item")[2]! as HTMLButtonElement,
    );
    expect(onSelect).toHaveBeenCalledWith("p3");
  });

  it("long-press opens the section management menu; a slop move cancels it", () => {
    vi.useFakeTimers();
    try {
      const onMenu = vi.fn();
      const { container } = render(
        <SectionPill
          pages={PAGES}
          activePageId="p1"
          onSelectSection={vi.fn()}
          onSectionContextMenu={onMenu}
          navigationLocked={false}
        />,
      );
      const segment = container.querySelectorAll(".vela-pill__item")[1]! as HTMLButtonElement;
      segment.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 40, clientY: 40 }),
      );
      // A drag-sized move cancels the pending long-press… (jsdom has no
      // PointerEvent constructor, so the coordinates ride a MouseEvent).
      segment.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 40 + 12, clientY: 40 }),
      );
      vi.advanceTimersByTime(600);
      expect(onMenu).not.toHaveBeenCalled();
      // …a still hold fires it with the press point.
      segment.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 40, clientY: 40 }),
      );
      vi.advanceTimersByTime(500);
      expect(onMenu).toHaveBeenCalledWith("p2", 40, 40);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the Menu key opens the management menu at the segment's anchor", () => {
    const onMenu = vi.fn();
    const { container } = mount(vi.fn(), { onSectionContextMenu: onMenu });
    const segment = container.querySelectorAll(".vela-pill__item")[1]! as HTMLButtonElement;
    fireEvent.keyDown(segment, { key: "ContextMenu" });
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onMenu.mock.calls[0]![0]).toBe("p2");
  });

  it("renders the compact form on short viewports: current name + steppers", () => {
    const matches = vi.fn((query: string) => query === "(max-height: 559px)");
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({ matches: matches(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
    );
    try {
      const onSelect = vi.fn();
      const { container } = render(
        <SectionPill
          pages={PAGES}
          activePageId="p1"
          onSelectSection={onSelect}
          onSectionContextMenu={vi.fn()}
          navigationLocked={false}
        />,
      );
      const pill = container.querySelector(".vela-pill")!;
      expect(pill.getAttribute("data-compact")).toBe("true");
      expect(container.querySelector(".vela-pill__compact-name")!.textContent).toContain(
        "前端开发",
      );
      const steppers = container.querySelectorAll(".vela-pill__stepper");
      expect(steppers).toHaveLength(2);
      // The first section cannot step back; forward steps to the neighbor.
      expect((steppers[0]! as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(steppers[1]! as HTMLButtonElement);
      expect(onSelect).toHaveBeenCalledWith("p2");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
