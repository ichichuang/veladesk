// @vitest-environment jsdom
/*
 * Task 023-A — persistent workspace view state, integration.
 *
 * The real DesktopShell boot (real rail, layers, scroll restore, GSAP
 * coordinator) against real window.localStorage, in jsdom. Injected only at
 * real boundaries: the fake workspace runtime (transport — SPIED in the
 * zero-write contract), the section scrollers' scrollHeight/clientHeight
 * (layout, so scrollTop values stick), and the section-nav trace (the
 * opt-in observer proving NO navigation is ever synthesized for a restore).
 *
 * Covered contracts: the first meaningful render is already the remembered
 * section (no default-section flash, no restore animation), scroll restore
 * through the existing SectionView mechanics, request-time persistence of
 * the logical destination, unmount/pagehide flushes, per-workspace
 * isolation on re-entry, deleted-section fallback with persisted-state
 * repair, and zero workspace revisions from any of it. DOM-emulated
 * geometry does not prove painted pixels.
 */

import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { WorkspaceRuntimeContextProvider } from "../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { DesktopShell } from "./desktop-shell";
import { workspaceViewStateStorageKey } from "./workspace-view-state";
import { gsap } from "@components/vd/gsap";

const PAGE_NAMES: Record<string, string> = {
  "page-a": "Alpha",
  "page-b": "Beta",
  "page-c": "Gamma",
  "page-d": "Delta",
  "page-x": "Xi",
  "page-y": "Yi",
};

/** Workspace ws-1: Alpha/Beta/Gamma/Delta, default Alpha. */
function fourPageWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-1",
    workspaceName: "One",
    pageId: "page-a",
    pageName: "Alpha",
    grid: { columns: 6, rows: 4 },
  });
  const pages: DesktopPage[] = (["page-a", "page-b", "page-c", "page-d"] as const).map(
    (id) => ({
      ...base.pages[0]!,
      id,
      name: PAGE_NAMES[id]!,
      layout: { ...base.pages[0]!.layout, id },
    }),
  );
  return { ...base, pages };
}

/** Workspace ws-2: Xi/Yi, default Xi — a different section universe. */
function twoPageWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-2",
    workspaceName: "Two",
    pageId: "page-x",
    pageName: "Xi",
    grid: { columns: 6, rows: 4 },
  });
  const pages: DesktopPage[] = (["page-x", "page-y"] as const).map((id) => ({
    ...base.pages[0]!,
    id,
    name: PAGE_NAMES[id]!,
    layout: { ...base.pages[0]!.layout, id },
  }));
  return { ...base, pages };
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

/** Transport seam. Spied in the zero-write test; rejecting otherwise. */
function makeRuntime(spies?: {
  stageWorkspaceUpdate: () => Promise<unknown>;
  syncCurrent: () => Promise<unknown>;
  pullCurrent: () => Promise<unknown>;
}): WorkspaceClientRuntime {
  if (spies !== undefined) {
    const never = () => new Promise(() => {}) as never;
    return {
      getSnapshot: never,
      subscribe: () => () => {},
      initialize: never,
      selectWorkspace: never,
      stageWorkspaceCreate: never,
      stageWorkspaceUpdate: spies.stageWorkspaceUpdate as never,
      syncCurrent: spies.syncCurrent as never,
      pullCurrent: spies.pullCurrent as never,
      close: () => {},
    };
  }
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

type HostProps = {
  readonly record?: LocalWorkspaceRecord;
  readonly strict?: boolean;
  readonly runtime?: WorkspaceClientRuntime;
};

function ShellHost({
  record = makeRecord(fourPageWorkspace()),
  strict = false,
  runtime = makeRuntime(),
}: HostProps) {
  const shell = (
    <WorkspaceRuntimeContextProvider value={runtime}>
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

function scrollerOf(pageId: string): HTMLElement {
  const scroller = layerOf(pageId).querySelector(".vela-section-scroller");
  if (!(scroller instanceof HTMLElement)) {
    throw new Error(`scroller not mounted: ${pageId}`);
  }
  return scroller;
}

/** Persists a v1 view state for one workspace directly (the disk state). */
function seedViewState(
  workspaceId: string,
  activeSectionId: string | null,
  scrollTopBySectionId: Record<string, number> = {},
): void {
  window.localStorage.setItem(
    workspaceViewStateStorageKey(workspaceId),
    JSON.stringify({ version: 1, activeSectionId, scrollTopBySectionId, updatedAt: 1 }),
  );
}

function storedViewState(workspaceId: string): {
  activeSectionId: string | null;
  scrollTopBySectionId: Record<string, number>;
} | null {
  const raw = window.localStorage.getItem(workspaceViewStateStorageKey(workspaceId));
  if (raw === null) {
    return null;
  }
  const parsed = JSON.parse(raw) as {
    activeSectionId: string | null;
    scrollTopBySectionId: Record<string, number>;
  };
  return parsed;
}

async function navigateTo(pageName: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: pageName }));
  });
}

/**
 * The "no navigation was ever synthesized" observer: a restore-driven
 * switch would leave a pair timeline behind (or, on the instant path, save
 * the DEFAULT section's scrollTop into the persisted view state as it left
 * — checked at unmount in the no-flash test).
 */
function expectNoNavigationRan(): void {
  expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(0);
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  // Layout seam: the section scrollers report a scrollable range so
  // scrollTop values stick; everything else keeps jsdom defaults.
  for (const [property, value] of [
    ["scrollHeight", 2000],
    ["clientHeight", 480],
  ] as const) {
    Object.defineProperty(Element.prototype, property, {
      get() {
        return (this as Element).classList?.contains("vela-section-scroller")
          ? value
          : 0;
      },
      configurable: true,
    });
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  gsap.globalTimeline.clear();
});

describe("first meaningful render (023-A §7/§8/§30)", () => {
  it("the remembered section is the FIRST active section — no default flash, no restore animation", () => {
    seedViewState("ws-1", "page-c", { "page-c": 640 });
    const { container } = render(<ShellHost />);

    // The very first committed workspace render is already Gamma — the
    // persisted section participated in the initial state, and NO
    // navigation was ever synthesized to get there (an effect-driven
    // restore would leave input/request/instant trace entries and a pair
    // timeline behind).
    expect(layerOf("page-c").dataset.phase).toBe("active");
    // The warm set around the REMEMBERED section — not around the default.
    expect(layerOf("page-b").dataset.warmHidden).toBe("true");
    const activeRow = container.querySelector(
      '.vela-rail__item[data-active="true"]',
    ) as HTMLElement;
    expect(activeRow.dataset.pageId).toBe("page-c");
    expect(activeRow.getAttribute("aria-current")).toBe("page");
    expect(
      Number(gsap.getProperty(container.querySelector("[data-vd-indicator]")!, "opacity")),
    ).toBe(1);
    expectNoNavigationRan();
  });

  it("restores under StrictMode with the same guarantees", () => {
    seedViewState("ws-1", "page-b");
    render(<ShellHost strict />);
    expect(layerOf("page-b").dataset.phase).toBe("active");
    expectNoNavigationRan();
  });

  it("the remembered section's scrollTop restores through the existing scroll mechanics", () => {
    seedViewState("ws-1", "page-c", { "page-c": 640 });
    render(<ShellHost />);

    // The SectionView mount-restore (layout phase, clamped, never smooth)
    // applied the seeded value; an unremembered warm neighbor stays at 0.
    expect(scrollerOf("page-c").scrollTop).toBe(640);
    expect(scrollerOf("page-b").scrollTop).toBe(0);
  });

  it("a deleted persisted section falls back to the configured default — no error, no empty screen", () => {
    seedViewState("ws-1", "page-gone", { "page-gone": 999 });
    render(<ShellHost />);

    expect(layerOf("page-a").dataset.phase).toBe("active");
    expect(layerOf("page-a").querySelector(".vela-section-scroller")).not.toBeNull();
    expectNoNavigationRan();
  });
});

describe("persistence on navigation and exit (023-A §11/§13/§31/§33/§34)", () => {
  it("remount (refresh semantics) reopens on the last destination with no animation", async () => {
    const first = render(<ShellHost />);
    await navigateTo("Beta");
    first.unmount();

    // The unmount flush persisted the logical destination synchronously.
    expect(storedViewState("ws-1")?.activeSectionId).toBe("page-b");

    const second = render(<ShellHost />);
    expect(layerOf("page-b").dataset.phase).toBe("active");
    expectNoNavigationRan();
    expect(gsap.globalTimeline.getChildren(false, false, true)).toHaveLength(0);
    second.unmount();
  });

  it("rapid A→B→C→D before any flush persists only D (request-time, latest wins)", async () => {
    const view = render(<ShellHost />);
    // Three accepted requests in immediate succession — none of the pair
    // timelines is driven to completion before the shell goes away. The
    // playheads are FROZEN after every click: on a slow runner the real
    // ticker could otherwise settle the B→C pair between clicks (an extra
    // "left" section in the flushed map — the Release-quality flake), which
    // a fast machine never interleaves.
    const freezeTimelines = () => {
      for (const animation of gsap.globalTimeline.getChildren(false, false, true)) {
        animation.pause();
      }
    };
    await navigateTo("Beta");
    freezeTimelines();
    await navigateTo("Gamma");
    freezeTimelines();
    await navigateTo("Delta");
    freezeTimelines();
    view.unmount();

    const stored = storedViewState("ws-1");
    expect(stored?.activeSectionId).toBe("page-d");
    // Exactly the sections that were visibly LEFT (each at scrollTop 0) —
    // the parked destinations were never left, so they carry no entry.
    expect(stored?.scrollTopBySectionId).toEqual({ "page-a": 0, "page-b": 0 });
  });

  it("pagehide flushes the latest state and the active section's live scrollTop synchronously", async () => {
    seedViewState("ws-1", "page-c", { "page-c": 640 });
    const view = render(<ShellHost />);
    expect(scrollerOf("page-c").scrollTop).toBe(640);
    scrollerOf("page-c").scrollTop = 300;

    window.dispatchEvent(new Event("pagehide"));

    const stored = storedViewState("ws-1");
    expect(stored?.activeSectionId).toBe("page-c");
    expect(stored?.scrollTopBySectionId["page-c"]).toBe(300);
    view.unmount();
  });

  it("leaving a section persists its scrollTop with the navigation", async () => {
    const view = render(<ShellHost />);
    scrollerOf("page-a").scrollTop = 220;
    await navigateTo("Beta");
    view.unmount();

    const stored = storedViewState("ws-1");
    expect(stored?.activeSectionId).toBe("page-b");
    expect(stored?.scrollTopBySectionId["page-a"]).toBe(220);
  });
});

describe("workspace isolation and in-app re-entry (023-A §21/§22)", () => {
  it("each workspace remembers its own last section across re-entry", () => {
    seedViewState("ws-1", "page-c");
    seedViewState("ws-2", "page-y");

    const first = render(<ShellHost record={makeRecord(fourPageWorkspace())} />);
    expect(layerOf("page-c").dataset.phase).toBe("active");
    first.unmount();

    const second = render(<ShellHost record={makeRecord(twoPageWorkspace())} />);
    expect(layerOf("page-y").dataset.phase).toBe("active");
    second.unmount();

    const third = render(<ShellHost record={makeRecord(fourPageWorkspace())} />);
    expect(layerOf("page-c").dataset.phase).toBe("active");
    third.unmount();

    // Two distinct workspace-scoped keys, each holding its own state.
    expect(storedViewState("ws-1")?.activeSectionId).toBe("page-c");
    expect(storedViewState("ws-2")?.activeSectionId).toBe("page-y");
  });

  it("a stale persisted section is repaired on the next flush after fallback", async () => {
    seedViewState("ws-1", "page-gone", { "page-gone": 999 });
    const view = render(<ShellHost />);
    expect(layerOf("page-a").dataset.phase).toBe("active");
    await navigateTo("Beta");
    view.unmount();

    const stored = storedViewState("ws-1");
    expect(stored?.activeSectionId).toBe("page-b"); // repaired forward, never "page-gone"
  });
});

describe("zero workspace writes (023-A §35)", () => {
  it("view-state restore, navigation and flushes never touch the workspace runtime", async () => {
    const spies = {
      stageWorkspaceUpdate: vi.fn(() => new Promise<never>(() => {})),
      syncCurrent: vi.fn(() => new Promise<never>(() => {})),
      pullCurrent: vi.fn(() => new Promise<never>(() => {})),
    };
    seedViewState("ws-1", "page-c", { "page-c": 640 });
    const view = render(<ShellHost runtime={makeRuntime(spies)} />);

    await navigateTo("Beta");
    window.dispatchEvent(new Event("pagehide"));
    view.unmount();

    expect(spies.stageWorkspaceUpdate).not.toHaveBeenCalled();
    expect(spies.syncCurrent).not.toHaveBeenCalled();
    expect(spies.pullCurrent).not.toHaveBeenCalled();
    // The only durable write is the tiny workspace-scoped view-state key.
    expect(storedViewState("ws-1")?.activeSectionId).toBe("page-b");
    expect(
      window.localStorage.getItem(workspaceViewStateStorageKey("ws-1"))?.length ?? 0,
    ).toBeLessThan(300);
  });
});
