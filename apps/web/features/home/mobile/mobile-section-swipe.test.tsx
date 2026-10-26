// @vitest-environment jsdom
/*
 * Mobile horizontal section swipe (the reported request: swipe left/right
 * in the content area to change category, seamlessly and infinitely).
 *
 * These drive the REAL MobileShell with pointer events. jsdom has no layout
 * engine, so the strip's `clientWidth` is injected — the gesture math is
 * then exact and the test can assert on the transform it writes.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { AppShortcut, DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { runtimeManagementStub } from "../../workspace-runtime/test-runtime-management";
import { WorkspaceRuntimeContextProvider } from "../../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../../i18n/ui-locale-provider";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { dispatchPointer, installPointerEventPolyfill } from "./pointer-event-test-support";
import { MobileShell } from "./mobile-shell";

const VIEWPORT = 400;

function app(id: string, name: string): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: `https://${id}.example.com/`,
    icon: { kind: "generated", text: name.slice(0, 1), source: "auto" },
    openMode: "new-tab",
    tags: [],
  };
}

function page(id: string, name: string, items: readonly string[]): DesktopPage {
  return {
    id,
    name,
    layout: { id, grid: { columns: 4, rows: 4 }, items: [] },
    canvas: {
      version: 2,
      mode: "grid",
      columns: 4,
      items: items.map((entityId, index) => ({
        id: entityId,
        column: index,
        row: 0,
        columnSpan: 1,
        rowSpan: 1,
      })),
    },
  };
}

function threeSections(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-swipe",
    workspaceName: "Desk",
    pageId: "page-a",
    pageName: "办公",
    grid: { columns: 4, rows: 4 },
  });
  return {
    ...base,
    pages: [
      page("page-a", "办公", ["app-a"]),
      page("page-b", "AI", ["app-b"]),
      page("page-c", "娱乐", ["app-c"]),
    ],
    entities: [app("app-a", "A草"), app("app-b", "ChatGPT"), app("app-c", "音乐")],
  };
}

function oneSection(): WorkspaceSnapshot {
  const base = threeSections();
  return { ...base, pages: [base.pages[0]!], entities: [base.entities[0]!] };
}

function twoSections(): WorkspaceSnapshot {
  const base = threeSections();
  return { ...base, pages: base.pages.slice(0, 2), entities: base.entities.slice(0, 2) };
}

function record(snapshot: WorkspaceSnapshot): LocalWorkspaceRecord {
  return {
    id: snapshot.id,
    snapshot,
    serverRevision: null,
    localGeneration: 0,
    syncState: "clean",
    updatedAt: 0,
    lastSyncedAt: null,
  };
}

const rejectRuntime: WorkspaceClientRuntime = {
  ...runtimeManagementStub,
  getSnapshot: () => {
    throw new Error("unexpected getSnapshot");
  },
  subscribe: () => () => {},
  initialize: () => Promise.reject(new Error("unexpected")),
  selectWorkspace: () => Promise.reject(new Error("unexpected")),
  stageWorkspaceCreate: () => Promise.reject(new Error("unexpected")),
  stageWorkspaceUpdate: () => Promise.reject(new Error("unexpected")),
  syncCurrent: () => Promise.reject(new Error("unexpected")),
  pullCurrent: () => Promise.reject(new Error("unexpected")),
  close: () => {},
};

function Host({ snapshot }: { readonly snapshot: WorkspaceSnapshot }) {
  const [pageId, setPageId] = useState<string | null>(snapshot.pages[0]!.id);
  const activeSection: WorkspaceActiveSection = {
    activePageId: pageId,
    effectiveActivePageId: pageId ?? snapshot.pages[0]!.id,
    requestActiveSection: (id) => setPageId(id),
    recordScrollTop: () => {},
  };
  return (
    <WorkspaceRuntimeContextProvider value={rejectRuntime}>
      <UiLocaleProvider>
        <MobileShell workspace={record(snapshot)} activeSection={activeSection} />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>
  );
}

/** jsdom has no layout: give the strip (and the scroller) a real width. */
function patchLayout(): void {
  const strip = document.querySelector<HTMLElement>(".vela-mobile-swipe-strip");
  if (strip === null) {
    throw new Error("strip not mounted");
  }
  for (const element of [strip, strip.parentElement].filter(
    (node): node is HTMLElement => node !== null,
  )) {
    Object.defineProperty(element, "clientWidth", {
      get: () => VIEWPORT,
      configurable: true,
    });
  }
}

function strip(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".vela-mobile-swipe-strip");
  if (element === null) {
    throw new Error("strip not mounted");
  }
  return element;
}

function transformX(): number {
  const value = strip().style.transform;
  const match = /translate(?:3d)?\((-?[\d.]+)px/.exec(value);
  return match === null ? 0 : Number.parseFloat(match[1]!);
}

function activeTabName(): string | null {
  return screen.getByRole("tab", { selected: true }).textContent;
}

/**
 * One pointer gesture, timed like real hardware.
 *
 * Two things matter and neither is free in jsdom:
 *
 *  1. Real `PointerEvent`s, not `fireEvent.pointerDown`. jsdom has no
 *     `PointerEvent`, and testing-library's fallback event drops
 *     `pointerType` and the coordinates — the touch path would silently
 *     never run and the suite would pass for the wrong reason.
 *  2. Realistic TIMING. jsdom dispatches in microseconds, so `dt` in the
 *     velocity sampler would clamp to its 1ms floor and read every move as
 *     an impossibly fast flick. `frameMs` advances the clock as if the
 *     pointer were sampled once per animation frame; a caller can pass a
 *     larger `frameMs` to simulate a slow, deliberate drag.
 */
function swipe(options: {
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
  readonly steps?: number;
  readonly frameMs?: number;
  readonly pointerType?: "touch" | "mouse";
  readonly release?: boolean;
}): void {
  const {
    from,
    to,
    steps = 6,
    frameMs = 16,
    pointerType = "touch",
    release = true,
  } = options;
  const target = strip();
  const start = performance.now();
  dispatchPointer(target, "pointerdown", {
    pointerType,
    clientX: from.x,
    clientY: from.y,
    buttons: 1,
    timeStamp: start,
  });
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    dispatchPointer(window, "pointermove", {
      pointerType,
      clientX: x,
      clientY: y,
      timeStamp: start + frameMs * step,
    });
  }
  if (release) {
    dispatchPointer(window, "pointerup", {
      pointerType,
      clientX: to.x,
      clientY: to.y,
      timeStamp: start + frameMs * (steps + 1),
    });
  }
}

/** Let the settle tween finish (GSAP ticker runs on rAF). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 700);
    });
  });
}

let restorePointerEvent: () => void = () => {};

beforeEach(() => {
  window.localStorage.clear();
  restorePointerEvent = installPointerEventPolyfill();
});

afterEach(() => {
  cleanup();
  restorePointerEvent();
});

describe("swiping the mobile content area", () => {
  it("mounts a previous/active/next strip so the neighbour is already visible", () => {
    render(<Host snapshot={threeSections()} />);
    const slots = Array.from(
      document.querySelectorAll<HTMLElement>(".vela-mobile-swipe-slot"),
    ).map((slot) => ({ page: slot.dataset.sectionId, slot: slot.dataset.swipeSlot }));

    expect(slots).toEqual([
      { page: "page-c", slot: "-1" }, // wraps around from the first section
      { page: "page-a", slot: "0" },
      { page: "page-b", slot: "1" },
    ]);
  });

  it("follows the finger and commits to the next section on a long drag left", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();
    expect(activeTabName()).toBe("办公");

    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
    // The strip moved left with the finger (negative x) while dragging.
    expect(transformX()).toBeLessThan(0);

    await settle();
    expect(activeTabName()).toBe("AI");
    // Rest pose after the commit: back to 0 (the committed slot is centre).
    expect(transformX()).toBe(0);
  });

  it("commits to the PREVIOUS section on a drag right, wrapping to the last", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();
    expect(activeTabName()).toBe("办公");

    swipe({ from: { x: 80, y: 200 }, to: { x: 320, y: 200 } });
    await settle();

    // First section → last section: the loop has no seam.
    expect(activeTabName()).toBe("娱乐");
  });

  it("wraps forward from the last section back to the first", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    // Walk to the last section, then one more swipe forward.
    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
    await settle();
    expect(activeTabName()).toBe("AI");
    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
    await settle();
    expect(activeTabName()).toBe("娱乐");
    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
    await settle();
    expect(activeTabName()).toBe("办公");
  });

  it("springs back on a short slow drag (no accidental category change)", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    // 20px over many steps = slow, and below the commit ratio.
    swipe({ from: { x: 200, y: 200 }, to: { x: 180, y: 200 }, steps: 20 });
    await settle();

    expect(activeTabName()).toBe("办公");
    expect(transformX()).toBe(0);
  });

  it("never pages on a vertical drag — the grid keeps its native scroll", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    swipe({ from: { x: 200, y: 300 }, to: { x: 195, y: 120 }, steps: 10 });
    await settle();

    expect(activeTabName()).toBe("办公");
    expect(transformX()).toBe(0);
    // The gesture never claimed the horizontal axis.
    expect(strip().dataset.swipeActive).toBeUndefined();
  });

  it("ignores a mouse drag (desktop behaviour stays native)", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 }, pointerType: "mouse" });
    await settle();

    expect(activeTabName()).toBe("办公");
    expect(transformX()).toBe(0);
  });

  it("does not loop (and does not move) with a single section", async () => {
    render(<Host snapshot={oneSection()} />);
    patchLayout();
    const slots = document.querySelectorAll(".vela-mobile-swipe-slot");
    expect(slots).toHaveLength(1);
    expect(strip().dataset.swipeLooping).toBe("false");

    swipe({ from: { x: 320, y: 200 }, to: { x: 60, y: 200 } });
    await settle();

    expect(activeTabName()).toBe("办公");
    expect(transformX()).toBe(0);
  });

  it("keeps the tap path working and in sync with the swipe state", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "娱乐" }));
    });
    expect(activeTabName()).toBe("娱乐");
    expect(transformX()).toBe(0);

    // …and a swipe from there still lands on the right neighbour.
    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
    await settle();
    expect(activeTabName()).toBe("办公"); // 娱乐 → wraps to 办公
  });

  it("shows the neighbours only while a horizontal drag owns the pointer", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();
    expect(strip().dataset.swipeActive).toBeUndefined();

    swipe({ from: { x: 320, y: 200 }, to: { x: 200, y: 200 }, release: false });
    expect(strip().dataset.swipeActive).toBe("true");
    dispatchPointer(window, "pointercancel", { pointerType: "touch", clientX: 200, clientY: 200 });
    await settle();

    // A cancelled gesture never commits and leaves no offset behind.
    expect(activeTabName()).toBe("办公");
    expect(strip().dataset.swipeActive).toBeUndefined();
    expect(transformX()).toBe(0);
  });

  it("does not treat a held finger as a flick (stale velocity is dropped)", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    // A fast but short drag (40px of 400) that then HOLDS before release.
    const start = performance.now();
    dispatchPointer(strip(), "pointerdown", { pointerType: "touch", clientX: 300, clientY: 200, buttons: 1, timeStamp: start });
    dispatchPointer(window, "pointermove", { pointerType: "touch", clientX: 280, clientY: 200, timeStamp: start + 8 });
    dispatchPointer(window, "pointermove", { pointerType: "touch", clientX: 260, clientY: 200, timeStamp: start + 16 });
    dispatchPointer(window, "pointerup", { pointerType: "touch", clientX: 260, clientY: 200, timeStamp: start + 400 });
    await settle();

    expect(activeTabName()).toBe("办公");
    expect(transformX()).toBe(0);
  });

  it("loops two sections through ONE shared neighbour (no duplicate pane)", async () => {
    render(<Host snapshot={twoSections()} />);
    patchLayout();
    const slots = Array.from(document.querySelectorAll<HTMLElement>(".vela-mobile-swipe-slot"));
    expect(slots.map((slot) => slot.dataset.sectionId)).toEqual(["page-a", "page-b"]);

    swipe({ from: { x: 80, y: 200 }, to: { x: 320, y: 200 } });
    await settle();
    expect(activeTabName()).toBe("AI");
    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
    await settle();
    expect(activeTabName()).toBe("办公");
  });

  it("rests cleanly after a swipe: the strip is not left offset", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();
    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
    await settle();

    expect(strip().dataset.swipeActive).toBeUndefined();
    expect(transformX()).toBe(0);
  });

  it("swallows the stray click a paged drag leaves behind (no accidental app launch)", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    // Land the gesture on a tile: a real phone fires a click there on
    // release, which would otherwise launch the app the user just swiped.
    swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });

    const tile = strip().querySelector<HTMLElement>(".vela-mobile-tile__button");
    expect(tile).not.toBeNull();
    let reachedTarget = false;
    tile!.addEventListener("click", () => {
      reachedTarget = true;
    });
    // The browser's post-release click surfaces at the window in capture
    // phase — the guard intercepts it before the tile ever sees it.
    const stray = new MouseEvent("click", { bubbles: true, cancelable: true });
    window.dispatchEvent(stray);

    expect(reachedTarget).toBe(false);
    expect(stray.defaultPrevented).toBe(true);
    await settle();
  });

  it("still lets a deliberate TAP through (the guard is not a blanket click eater)", async () => {
    render(<Host snapshot={threeSections()} />);
    patchLayout();

    // No horizontal lock happened, so no click may be suppressed.
    const stray = new MouseEvent("click", { bubbles: true, cancelable: true });
    window.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(false);
  });
});

describe("respecting reduced motion", () => {
  it("swaps sections instantly without following the finger", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      render(<Host snapshot={threeSections()} />);
      patchLayout();

      swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 } });
      await settle();

      // Still paged — reduced motion removes the animation, not the feature.
      expect(activeTabName()).toBe("AI");
      expect(transformX()).toBe(0);

      // A real assertion on the reduced-motion path: no transform is written
      // mid-drag either.
      swipe({ from: { x: 320, y: 200 }, to: { x: 100, y: 200 }, release: false });
      expect(transformX()).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });
});
