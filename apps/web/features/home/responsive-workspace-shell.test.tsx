// @vitest-environment jsdom
/*
 * Task 026 §71/§72/§67/§73 — the responsive shell integration contract:
 * exactly one interaction shell mounts per resolved capability, none while
 * unresolved; the workspace RUNTIME identity survives desktop↔mobile swaps
 * without re-bootstrapping; a shell switch stages NOTHING (zero workspace
 * revisions, zero sync); and the ACTIVE SECTION is continuous across swaps
 * with no default-section flash. jsdom + RTL render real shells (real rail,
 * real tabs); DOM-emulated geometry proves structure, never painted pixels.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { WorkspaceRuntimeContextProvider, useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { ResponsiveWorkspaceShell } from "./responsive-workspace-shell";

const NARROW_QUERY = "(max-width: 767px)";

/** 3 sections: 办公(default)/AI/娱乐, each with one app. */
function workspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-r",
    workspaceName: "Responsive",
    pageId: "page-a",
    pageName: "办公",
    grid: { columns: 6, rows: 4 },
  });
  const pages: DesktopPage[] = (["page-a", "page-b", "page-c"] as const).map((id, index) => ({
    id,
    name: ["办公", "AI", "娱乐"][index]!,
    layout: { id, grid: { columns: 6, rows: 4 }, items: [] },
    canvas: {
      version: 2,
      mode: "grid",
      columns: 6,
      items: [{ id: `app-${id}`, column: 0, row: 0, columnSpan: 1, rowSpan: 1 }],
    },
  }));
  return {
    ...base,
    pages,
    entities: pages.map((page) => ({
      kind: "app" as const,
      id: `app-${page.id}`,
      name: `App ${page.name}`,
      url: "https://example.com/",
      icon: { kind: "generated" as const, text: "AP" },
      openMode: "new-tab" as const,
      tags: [],
    })),
    dock: { items: [] },
  };
}

function makeRecord(): LocalWorkspaceRecord {
  const snapshot = workspace();
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

type ChangeListener = (event: { matches: boolean }) => void;

/**
 * A controllable matchMedia double. `matchesFor(query)` decides live
 * matches; `flip()` re-evaluates and notifies listeners (resize/rotate).
 * Reduced motion reports ON so every section switch in this suite takes
 * the deterministic instant path.
 */
function installMatchMedia(matchesFor: (query: string) => boolean) {
  const listenersByQuery = new Map<string, Set<ChangeListener>>();
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      get matches() {
        return matchesFor(query);
      },
      media: query,
      onchange: null,
      addEventListener(_type: string, listener: ChangeListener) {
        const listeners = listenersByQuery.get(query) ?? new Set<ChangeListener>();
        listeners.add(listener);
        listenersByQuery.set(query, listeners);
      },
      removeEventListener(_type: string, listener: ChangeListener) {
        listenersByQuery.get(query)?.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
  return {
    flip() {
      for (const [query, listeners] of listenersByQuery) {
        const matches = matchesFor(query);
        for (const listener of listeners) {
          listener({ matches });
        }
      }
    },
  };
}

const runtimeSpies = {
  stageWorkspaceUpdate: vi.fn(() => Promise.resolve({ ok: true } as never)),
  syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" } as never)),
  pullCurrent: vi.fn(() => Promise.resolve({ status: "pulled" } as never)),
  stageWorkspaceCreate: vi.fn(() => Promise.resolve({ ok: true } as never)),
  selectWorkspace: vi.fn(() => Promise.resolve({ status: "ready" } as never)),
  initialize: vi.fn(() => Promise.resolve({ status: "ready" } as never)),
};

const runtime: WorkspaceClientRuntime = {
  getSnapshot: () => {
    throw new Error("unexpected getSnapshot");
  },
  subscribe: () => () => {},
  ...runtimeSpies,
  close: () => {},
};

/** Records every runtime identity the tree observes (§72). */
const seenRuntimes = new Set<unknown>();
function RuntimeIdentityProbe() {
  seenRuntimes.add(useWorkspaceRuntimeInstance());
  return null;
}

function Host({ record }: { readonly record: LocalWorkspaceRecord }) {
  return (
    <WorkspaceRuntimeContextProvider value={runtime}>
      <RuntimeIdentityProbe />
      <UiLocaleProvider>
        <ResponsiveWorkspaceShell workspace={record} />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  seenRuntimes.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("single-shell mount policy (§71)", () => {
  it("capability UNRESOLVED: neither shell mounts — the startup surface stays", () => {
    // No matchMedia stub installed: the hook cannot resolve and keeps the
    // existing loading surface; neither interaction shell may mount.
    const { container } = render(<Host record={makeRecord()} />);
    expect(container.querySelector(".vela-desktop")).toBeNull();
    expect(container.querySelector("[data-vd-mobile-shell]")).toBeNull();
    expect(container.querySelector(".vela-boot, .vela-screen")).not.toBeNull();
  });

  it("resolved MOBILE: exactly the mobile shell, never the desktop", async () => {
    installMatchMedia((query) => query === NARROW_QUERY);
    render(<Host record={makeRecord()} />);
    expect(await screen.findByRole("tablist", {}, { timeout: 8000 })).not.toBeNull();
    expect(document.querySelector("[data-vd-mobile-shell]")).not.toBeNull();
    expect(document.querySelector(".vela-desktop")).toBeNull();
  });

  it("resolved DESKTOP: exactly the desktop shell, never the mobile", async () => {
    installMatchMedia(() => false);
    render(<Host record={makeRecord()} />);
    expect(await screen.findByRole("button", { name: "办公" }, { timeout: 8000 })).not.toBeNull();
    expect(document.querySelector(".vela-desktop")).not.toBeNull();
    expect(document.querySelector("[data-vd-mobile-shell]")).toBeNull();
  });
});

describe("runtime identity across shell swaps (§72/§4)", () => {
  it("desktop → mobile → desktop: ONE runtime instance, no re-bootstrap, no workspace write (§67)", async () => {
    let mobile = false;
    const media = installMatchMedia((query) => mobile && query === NARROW_QUERY);
    const record = makeRecord();
    render(<Host record={record} />);

    // Desktop first.
    expect(await screen.findByRole("button", { name: "办公" }, { timeout: 8000 })).not.toBeNull();
    expect(document.querySelector(".vela-desktop")).not.toBeNull();

    // Narrow the viewport: DesktopShell unmounts, MobileShell mounts.
    mobile = true;
    await act(async () => {
      media.flip();
    });
    expect(await screen.findByRole("tablist", {}, { timeout: 8000 })).not.toBeNull();
    expect(document.querySelector(".vela-desktop")).toBeNull();

    // Widen again: MobileShell unmounts, DesktopShell remounts.
    mobile = false;
    await act(async () => {
      media.flip();
    });
    expect(await screen.findByRole("button", { name: "办公" }, { timeout: 8000 })).not.toBeNull();
    expect(document.querySelector("[data-vd-mobile-shell]")).toBeNull();

    // ONE runtime identity throughout; the bootstrap was never re-run; no
    // workspace staging or sync ever happened from the swap itself.
    expect(seenRuntimes.size).toBe(1);
    expect(runtimeSpies.initialize).not.toHaveBeenCalled();
    expect(runtimeSpies.selectWorkspace).not.toHaveBeenCalled();
    expect(runtimeSpies.stageWorkspaceUpdate).not.toHaveBeenCalled();
    expect(runtimeSpies.stageWorkspaceCreate).not.toHaveBeenCalled();
    expect(runtimeSpies.syncCurrent).not.toHaveBeenCalled();
    expect(runtimeSpies.pullCurrent).not.toHaveBeenCalled();
  });
});

describe("active section continuity across shells (§73)", () => {
  it("desktop AI → mobile keeps AI; mobile 娱乐 → desktop keeps 娱乐 — no default flash", async () => {
    let mobile = false;
    const media = installMatchMedia((query) => mobile && query === NARROW_QUERY);
    render(<Host record={makeRecord()} />);

    // Desktop: activate AI through the rail.
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "AI" }, { timeout: 8000 }));
    });

    // Swap to mobile: the AI tab is ALREADY selected — no default-section
    // flash through 办公.
    mobile = true;
    await act(async () => {
      media.flip();
    });
    const tabs = await screen.findAllByRole("tab", {}, { timeout: 8000 });
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    // The mobile grid shows AI's app immediately.
    expect(screen.getByText("App AI")).not.toBeNull();

    // Mobile: pick 娱乐, then swap back to desktop.
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "娱乐" }));
    });
    mobile = false;
    await act(async () => {
      media.flip();
    });
    // Desktop rail: 娱乐 is current — immediately, not after a flash.
    const activeRailRow = await screen.findByRole("button", { name: "娱乐" }, { timeout: 8000 });
    expect(activeRailRow.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector('.vela-rail__item[data-active="true"]')?.getAttribute("data-page-id")).toBe("page-c");
  });
});
