// @vitest-environment jsdom
/*
 * Task 022-R2 — the section-navigation rollback regression.
 *
 * This suite mounts the REAL navigation owner (DesktopShell) with its real
 * machine, the REAL GSAP pair coordinator, real layer registration and the
 * real rail, in jsdom. Only genuine boundaries are injected: the fake
 * workspace runtime (transport), the section viewport's clientHeight
 * (dimensions), and the pair timeline's playhead (animation time) — driven
 * through gsap.globalTimeline, never a mocked animation object.
 *
 * The core assertion is the COMPLETION BOUNDARY contract: when the A→B pair
 * finishes, B is the same mounted node at y=0 through completion, and A
 * stays outside the viewport until the React settlement commit hides it
 * (data-warm-hidden) — only then may A be normalized to the hidden-cache
 * origin. The assertions inside the act() scope observe exactly the window
 * a real browser paints (the GSAP tick runs, React's commit has not), so a
 * synchronous layer-rest at completion is caught as the visible rollback it
 * is. DOM-emulated geometry does not prove painted pixels; it proves the
 * DOM/style state every paint of that window would show.
 */

import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { WorkspaceRuntimeContextProvider } from "../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { DesktopShell } from "./desktop-shell";
import { gsap } from "@components/vd/gsap";

const H = 480; // injected viewport height — never a browser measurement

const PAGE_IDS = ["page-a", "page-b", "page-c", "page-d"] as const;
const PAGE_NAMES: Record<string, string> = {
  "page-a": "Alpha",
  "page-b": "Beta",
  "page-c": "Gamma",
  "page-d": "Delta",
};

/** Four empty pages, default page-a — the minimum real section topology. */
function fourPageWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-1",
    workspaceName: "Test",
    pageId: "page-a",
    pageName: "Alpha",
    grid: { columns: 6, rows: 4 },
  });
  const pages: DesktopPage[] = PAGE_IDS.map((id) => ({
    ...base.pages[0]!,
    id,
    name: PAGE_NAMES[id]!,
    layout: { ...base.pages[0]!.layout, id },
  }));
  return { ...base, pages };
}

/** The same topology with a VALID configured default other than the first. */
function workspaceDefaultingTo(pageId: string): WorkspaceSnapshot {
  const snapshot = fourPageWorkspace();
  return { ...snapshot, preferences: { ...snapshot.preferences, defaultPageId: pageId } };
}

function makeRecord(snapshot: WorkspaceSnapshot): LocalWorkspaceRecord {
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

/** The runtime seam: DesktopShell only stages/syncs through it — never on navigation. */
function makeRuntime(): WorkspaceClientRuntime {
  const reject = (name: string) =>
    Promise.reject(new Error(`unexpected runtime call in test: ${name}`)) as never;
  return {
    getSnapshot: () => {
      throw new Error("unexpected getSnapshot in test");
    },
    subscribe: () => () => {},
    initialize: () => reject("initialize"),
    selectWorkspace: () => reject("selectWorkspace"),
    stageWorkspaceCreate: () => reject("stageWorkspaceCreate"),
    stageWorkspaceUpdate: () => reject("stageWorkspaceUpdate"),
    syncCurrent: () => reject("syncCurrent"),
    pullCurrent: () => reject("pullCurrent"),
    close: () => {},
  };
}

type HostProps = { record?: LocalWorkspaceRecord; strict?: boolean };

function ShellHost({ record = makeRecord(fourPageWorkspace()), strict = false }: HostProps) {
  const shell = (
    <WorkspaceRuntimeContextProvider value={makeRuntime()}>
      <UiLocaleProvider>
        <DesktopShell workspace={record} />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>
  );
  return strict ? <StrictMode>{shell}</StrictMode> : shell;
}

function layerOf(pageId: string): HTMLElement {
  const layer = document.querySelector(`section[data-page-id="${pageId}"]`);
  if (!(layer instanceof HTMLElement)) {
    throw new Error(`layer not mounted: ${pageId}`);
  }
  return layer;
}

function viewportElement(): HTMLElement {
  const viewport = document.querySelector(".vela-section-viewport");
  if (!(viewport instanceof HTMLElement)) {
    throw new Error("section viewport not mounted");
  }
  return viewport;
}

function yOf(element: HTMLElement): number {
  return Number(gsap.getProperty(element, "y"));
}

/**
 * The ONE live pair timeline (animation-time seam): the coordinator builds
 * it on gsap.globalTimeline; everything else GSAP runs here is a tween. A
 * jsdom ticker may not have rendered the young timeline yet (isActive()
 * needs a first tick), so "live" = not yet completed.
 */
function livePairTimeline(): gsap.core.Timeline {
  const timelines = gsap.globalTimeline.getChildren(false, false, true);
  const live = timelines.filter((timeline) => timeline.progress() < 1);
  if (live.length !== 1) {
    throw new Error(`expected exactly one live pair timeline, found ${live.length}`);
  }
  return live[0] as gsap.core.Timeline;
}

/** Makes a jsdom element report a layout dimension (the dimensions seam). */
function stubBox(element: HTMLElement, props: Record<string, number>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(element, key, { get: () => value, configurable: true });
  }
}

/** Clicks a rail title through the real user-facing control. */
async function navigateTo(pageName: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: pageName }));
  });
}

beforeAll(() => {
  // jsdom has no scrollIntoView; the rail's reveal-scroll is not under test.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  gsap.globalTimeline.clear();
  // 023-A: each test's unmount flush persists its view state to real
  // localStorage — clear it so the next test boots from a clean browser.
  window.localStorage.clear();
});

describe("A→B completion boundary (022-R2 rollback)", () => {
  it("keeps the outgoing page outside the viewport until the settlement commit hides it", async () => {
    render(<ShellHost />);
    stubBox(viewportElement(), { clientHeight: H });

    await navigateTo("Beta");

    const layerA = layerOf("page-a");
    const layerB = layerOf("page-b");
    stubBox(layerB.querySelector(".vela-section-scroller") as HTMLElement, {
      scrollHeight: 2000,
      clientHeight: H,
    });
    (layerB.querySelector(".vela-section-scroller") as HTMLElement).scrollTop = 700;

    await act(async () => {
      livePairTimeline().progress(1);
      // The window a browser paints between the final timeline update and
      // React's idle commit: A must STILL be outside the viewport here.
      expect(yOf(layerA)).toBe(-H);
      expect(layerA.dataset.phase).toBe("exit"); // visible phase, offscreen pose
      expect(yOf(layerB)).toBe(0);
      // Nothing but the pair wrote opacity — the slide never crossfades.
      expect(layerB.style.opacity === "" || layerB.style.opacity === "1").toBe(true);
    });

    // Settlement commit landed: B interactive at rest, A hidden AND rested —
    // the rest may only happen together with (or after) the hiding commit.
    expect(layerA.dataset.warmHidden).toBe("true");
    expect(yOf(layerA)).toBe(0);
    expect(layerB.dataset.phase).toBe("active");
    expect(yOf(layerB)).toBe(0);
    expect(layerB.dataset.activeSection).toBe("true");
    expect(layerB.querySelector(".vela-section-scroller")?.scrollTop).toBe(700);
    expect(viewportElement().dataset.sectionTransitioning).toBeUndefined();
  });

  it("mirrors the same boundary for a previous-direction (B→A) completion", async () => {
    render(<ShellHost />);
    stubBox(viewportElement(), { clientHeight: H });

    await navigateTo("Beta");
    await act(async () => {
      livePairTimeline().progress(1);
    });

    const layerA = layerOf("page-a");
    const layerB = layerOf("page-b");
    await navigateTo("Alpha");
    await act(async () => {
      livePairTimeline().progress(1);
      // "prev" slides the outgoing page DOWN: B must stay at +H here.
      expect(yOf(layerB)).toBe(H);
      expect(layerB.dataset.phase).toBe("exit");
      expect(yOf(layerA)).toBe(0);
    });
    expect(layerB.dataset.warmHidden).toBe("true");
    expect(yOf(layerB)).toBe(0);
    expect(layerA.dataset.phase).toBe("active");
  });

  it("keeps the destination node identity across settle and warm rotation (retention)", async () => {
    render(<ShellHost />);
    stubBox(viewportElement(), { clientHeight: H });

    const layerABefore = layerOf("page-a");
    await navigateTo("Beta");
    await act(async () => {
      livePairTimeline().progress(1);
    });
    // A survived the settle mounted (warm cache around B keeps it).
    expect(layerOf("page-a")).toBe(layerABefore);
    expect(layerOf("page-a").dataset.warmHidden).toBe("true");

    // Second hop: the rotation around C keeps [B,C,D] — A deregisters. Its
    // deregistration may not disturb the settled destination.
    const layerB = layerOf("page-b");
    const scrollerB = layerB.querySelector(".vela-section-scroller") as HTMLElement;
    stubBox(scrollerB, { scrollHeight: 2000, clientHeight: H });
    scrollerB.scrollTop = 300;

    await navigateTo("Gamma");
    await act(async () => {
      livePairTimeline().progress(1);
    });

    expect(layerOf("page-b")).toBe(layerB); // same node through the hop
    expect(scrollerB.scrollTop).toBe(300);
    expect(layerOf("page-c").dataset.phase).toBe("active");
    // A was evicted by the rotation around C — its deregistration is a
    // cache event, never permission to reset the live layers.
    expect(document.querySelector('section[data-page-id="page-a"]')).toBeNull();
    expect(yOf(layerOf("page-c"))).toBe(0);
    expect(yOf(layerB)).toBe(0);
  });
});

describe("initial rail selection through the workspace-entry policy (022-R2)", () => {
  it("a valid configured category other than the first agrees across background, aria-current, marker and displayed section", async () => {
    const record = makeRecord(workspaceDefaultingTo("page-c"));
    render(
      <WorkspaceRuntimeContextProvider value={makeRuntime()}>
        <UiLocaleProvider>
          <DesktopShell workspace={record} />
        </UiLocaleProvider>
      </WorkspaceRuntimeContextProvider>,
    );

    // The rail highlights exactly the configured default — never the first
    // row as a guess, never a hover/focus artifact.
    const activeRows = document.querySelectorAll('.vela-rail__item[data-active="true"]');
    expect(activeRows).toHaveLength(1);
    expect((activeRows[0] as HTMLElement).dataset.pageId).toBe("page-c");
    expect((activeRows[0] as HTMLElement).getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    // The displayed section is the same page (its warm neighbors are the
    // pages around the DEFAULT, not around the first row), and the ONE
    // marker carries a placed box (the pre-022-R2 marker never placed on
    // first entry and painted the stylesheet's percent stretch instead).
    expect(layerOf("page-c").dataset.phase).toBe("active");
    expect(layerOf("page-b").dataset.warmHidden).toBe("true");
    expect(layerOf("page-d").dataset.warmHidden).toBe("true");
    const markers = document.querySelectorAll("[data-vd-indicator]");
    expect(markers).toHaveLength(1);
    expect(Number(gsap.getProperty(markers[0] as HTMLElement, "opacity"))).toBe(1);
  });

  it("a same-workspace snapshot replacement never re-applies the startup selection", async () => {
    const { rerender } = render(<ShellHost />);
    stubBox(viewportElement(), { clientHeight: H });

    await navigateTo("Beta");

    // An unrelated snapshot replacement (sync notification shape) lands
    // while the pair is mid-flight: the requested target still owns the
    // rail, and nothing re-applies the startup selection.
    rerender(<ShellHost record={makeRecord(fourPageWorkspace())} />);

    expect(
      (
        document.querySelector(
          '.vela-rail__item[data-active="true"]',
        ) as HTMLElement | null
      )?.dataset.pageId,
    ).toBe("page-b");

    await act(async () => {
      livePairTimeline().progress(1);
    });
    expect(layerOf("page-b").dataset.phase).toBe("active");
  });
});

describe("interruption policies at the real boundaries (022-R2)", () => {
  it("an intentional mid-flight reversal returns to the origin without a visible bounce of the abandoned target", async () => {
    render(<ShellHost />);
    stubBox(viewportElement(), { clientHeight: H });

    await navigateTo("Beta");
    await act(async () => {
      livePairTimeline().progress(0.4);
    });

    const layerA = layerOf("page-a");
    const layerB = layerOf("page-b");

    await navigateTo("Alpha"); // reversal: A is the outgoing page of the running pair
    await act(async () => {
      livePairTimeline().progress(1);
      // B is the abandoned target mid-exit at the completion boundary: it
      // must still hold its exit pose (outside the viewport), not be rested
      // into view while its phase still says "exit".
      expect(yOf(layerB)).toBe(H);
      expect(layerB.dataset.phase).toBe("exit");
      expect(yOf(layerA)).toBe(0);
    });
    expect(layerA.dataset.phase).toBe("active");
    expect(layerB.dataset.warmHidden).toBe("true");
    expect(yOf(layerB)).toBe(0);
  });

  it("a parked third destination is adopted at settle and never resurrects the first source", async () => {
    render(<ShellHost />);
    stubBox(viewportElement(), { clientHeight: H });

    const layerA = layerOf("page-a");
    await navigateTo("Beta");
    await act(async () => {
      livePairTimeline().progress(0.5);
    });
    await navigateTo("Gamma"); // third destination during motion — parked

    await act(async () => {
      livePairTimeline().progress(1);
      // The A→B pair completed: A must still hold its exit pose here (the
      // parked adoption and warm rotation commit only after this scope).
      expect(yOf(layerA)).toBe(-H);
      expect(layerA.dataset.phase).toBe("exit");
    });

    // The parked destination was adopted at the settle: its request already
    // owns the logical active id, so the settle rotates the warm set around
    // it and it renders at rest — the bounded latest-target policy, with no
    // second animation and no resurrection of A.
    const layerC = layerOf("page-c");
    expect(layerC.dataset.phase).toBe("active");
    expect(yOf(layerC)).toBe(0);
    expect(viewportElement().dataset.sectionTransitioning).toBeUndefined();
    // The rotation around C evicted A entirely — never shown at the origin.
    expect(layerA.isConnected).toBe(false);
    expect(yOf(layerOf("page-b"))).toBe(0);
    expect(layerOf("page-b").dataset.warmHidden).toBe("true");
  });

  it("an unrelated rerender carrying the same generation never restarts the live playhead", async () => {
    const record = makeRecord(fourPageWorkspace());
    const { rerender } = render(<ShellHost record={record} />);
    stubBox(viewportElement(), { clientHeight: H });

    await navigateTo("Beta");
    await act(async () => {
      livePairTimeline().progress(0.3);
    });
    const timeline = livePairTimeline();
    // The pair is a real auto-playing timeline: pause it so the playhead
    // reading below is deterministic against wall-clock ticks.
    timeline.pause();
    const layerA = layerOf("page-a");

    // A same-workspace snapshot replacement (sync notification shape).
    await act(async () => {
      rerender(<ShellHost record={makeRecord(fourPageWorkspace())} />);
    });

    expect(gsap.globalTimeline.getChildren(false, false, true)).toContain(timeline);
    expect(timeline.progress()).toBeCloseTo(0.3, 5);
    expect(layerOf("page-a")).toBe(layerA);

    await act(async () => {
      timeline.progress(1);
      expect(yOf(layerA)).toBe(-H);
    });
    expect(layerOf("page-b").dataset.phase).toBe("active");
  });

  it("completes coherently under StrictMode (double-invoked effects settle once)", async () => {
    render(<ShellHost strict />);
    stubBox(viewportElement(), { clientHeight: H });

    await navigateTo("Beta");
    const layerA = layerOf("page-a");
    await act(async () => {
      livePairTimeline().progress(1);
      expect(yOf(layerA)).toBe(-H);
    });
    expect(layerOf("page-b").dataset.phase).toBe("active");
    expect(yOf(layerA)).toBe(0);
    expect(layerA.dataset.warmHidden).toBe("true");
  });

  it("reduced motion swaps instantly — no pair timeline, one painted section", async () => {
    const savedMatchMedia = window.matchMedia;
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

    try {
      render(<ShellHost />);
      stubBox(viewportElement(), { clientHeight: H });

      await navigateTo("Beta");

      expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(0);
      expect(layerOf("page-b").dataset.phase).toBe("active");
      expect(yOf(layerOf("page-b"))).toBe(0);
      expect(layerOf("page-a").dataset.warmHidden).toBe("true");
      expect(yOf(layerOf("page-a"))).toBe(0);
    } finally {
      if (savedMatchMedia === undefined) {
        delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
      } else {
        window.matchMedia = savedMatchMedia;
      }
    }
  });
});
