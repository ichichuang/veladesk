// @vitest-environment jsdom
/*
 * UX-12 — the mobile minimal edit path, at the component level: the tile
 * long-press contract (450ms + slop), the tile menu → shared-dialog
 * routing, the delete → undo-toast loop, the empty-section add entry and
 * the drawer's 添加应用 / 管理分区 entries. Real-interaction coverage
 * (CDP touch, persistence across reload) lives in
 * e2e/interaction-fix/ux-b3.spec.ts; these tests pin the wiring.
 */

import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type {
  AppShortcut,
  DesktopPage,
  Folder,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { runtimeManagementStub } from "../../workspace-runtime/test-runtime-management";
import { WorkspaceRuntimeContextProvider } from "../../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../../i18n/ui-locale-provider";
import { launchApp } from "../launch-app";
import { resetDawnOpeningSessionForTests } from "../scene/use-dawn-intro";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { MobileShell } from "./mobile-shell";
import { dispatchPointer, installPointerEventPolyfill } from "./pointer-event-test-support";

vi.mock("../launch-app", () => ({ launchApp: vi.fn() }));

function app(id: string, name: string): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: `https://${id}.example.com/`,
    icon: { kind: "generated", text: name.slice(0, 2) },
    openMode: "new-tab",
    tags: [],
  };
}

function gridCanvas(items: readonly { id: string; column: number; row: number }[]) {
  return {
    version: 2 as const,
    mode: "grid" as const,
    columns: 6,
    items: items.map((item) => ({
      id: item.id,
      column: item.column,
      row: item.row,
      columnSpan: 1,
      rowSpan: 1,
    })),
  };
}

function editWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-edit",
    workspaceName: "编辑工作区",
    pageId: "page-a",
    pageName: "办公",
    grid: { columns: 6, rows: 4 },
  });
  const page = (
    id: string,
    name: string,
    items: readonly { id: string; column: number; row: number }[],
  ): DesktopPage => ({
    id,
    name,
    layout: { id, grid: { columns: 6, rows: 4 }, items: [] },
    canvas: gridCanvas(items),
  });
  return {
    ...base,
    pages: [
      page("page-a", "办公", [
        { id: "app-github", column: 0, row: 0 },
        { id: "app-notion", column: 1, row: 0 },
      ]),
      page("page-b", "归档", []),
    ],
    entities: [
      app("app-github", "GitHub"),
      app("app-notion", "Notion"),
      { kind: "folder", id: "folder-x", name: "杂物", children: [] } satisfies Folder,
    ],
    dock: { items: [] },
  };
}

/** A staging runtime that mirrors every successful stage into the host's snapshot state. */
function makeStagingRuntime(
  onStaged: (snapshot: WorkspaceSnapshot) => void,
): WorkspaceClientRuntime {
  return {
    ...runtimeManagementStub,
    getSnapshot: () => {
      throw new Error("unexpected getSnapshot");
    },
    subscribe: () => () => {},
    initialize: () => Promise.reject(new Error("unexpected")),
    selectWorkspace: () => Promise.reject(new Error("unexpected")),
    stageWorkspaceCreate: () => Promise.reject(new Error("unexpected")),
    stageWorkspaceUpdate: (snapshot) => {
      const record: LocalWorkspaceRecord = {
        id: snapshot.id,
        snapshot,
        serverRevision: null,
        localGeneration: 1,
        syncState: "dirty",
        updatedAt: Date.now(),
        lastSyncedAt: null,
      };
      onStaged(snapshot);
      return Promise.resolve({
        ok: true,
        workspace: record,
        outbox: {
          id: "outbox",
          workspaceId: snapshot.id,
          revision: 1,
          snapshot,
          queuedAt: 0,
          operation: "save",
          baseRevision: 0,
          localGeneration: 1,
        },
      } as unknown as Awaited<ReturnType<WorkspaceClientRuntime["stageWorkspaceUpdate"]>>);
    },
    syncCurrent: () =>
      Promise.resolve({ ok: true } as unknown as Awaited<ReturnType<WorkspaceClientRuntime["syncCurrent"]>>),
    pullCurrent: () => Promise.reject(new Error("unexpected")),
    close: () => {},
  };
}

/** The mobile shell with a staging runtime and an owned active section. */
function EditHost({ initialPageId = "page-a" }: { readonly initialPageId?: string }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(editWorkspace());
  const [pageId, setPageId] = useState<string | null>(initialPageId);
  const runtime = useMemo(() => makeStagingRuntime(setSnapshot), []);
  const activeSection: WorkspaceActiveSection = {
    activePageId: pageId,
    effectiveActivePageId: pageId ?? snapshot.pages[0]!.id,
    requestActiveSection: (id) => setPageId(id),
    recordScrollTop: () => {},
    registerScrollCapture: () => {},
  };
  return (
    <WorkspaceRuntimeContextProvider value={runtime}>
      <UiLocaleProvider>
        <MobileShell
          workspace={{
            id: snapshot.id,
            snapshot,
            serverRevision: null,
            localGeneration: 0,
            syncState: "clean",
            updatedAt: 0,
            lastSyncedAt: null,
          }}
          activeSection={activeSection}
        />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>
  );
}

/** The ACTIVE pane's tile button for an app name. */
function tileButton(name: string): HTMLButtonElement {
  const slot = document.querySelector<HTMLElement>('[data-swipe-slot="0"]');
  if (slot === null) {
    throw new Error("active swipe slot not found");
  }
  const button = Array.from(slot.querySelectorAll<HTMLButtonElement>(".vela-mobile-tile__button")).find(
    (candidate) => candidate.textContent?.includes(name),
  );
  if (button === undefined) {
    throw new Error(`tile not found: ${name}`);
  }
  return button;
}

/** Real PointerEvents (jsdom has none — see pointer-event-test-support). */
function touch(
  tile: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x = 40,
  y = 40,
): void {
  dispatchPointer(tile, type, { pointerType: "touch", pointerId: 1, clientX: x, clientY: y });
}

async function hold(tile: HTMLButtonElement): Promise<void> {
  await act(async () => {
    touch(tile, "pointerdown");
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
}

beforeEach(() => {
  installPointerEventPolyfill();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  resetDawnOpeningSessionForTests();
});

describe("the tile long-press (UX-12)", () => {
  it("a 450ms hold on an app tile opens the action menu; the tile scales during the hold and restores when it opens", async () => {
    render(<EditHost />);
    const tile = tileButton("GitHub");
    expect(tile.getAttribute("data-hold")).toBeNull();

    await act(async () => {
      touch(tile, "pointerdown");
    });
    // Armed: the hold feedback is live.
    expect(tile.getAttribute("data-hold")).toBe("true");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });

    // The menu opened and the tile restored its size.
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /编辑/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /移到分区/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /删除/ })).toBeTruthy();
    expect(tile.getAttribute("data-hold")).toBeNull();
  });

  it("touch travel beyond the slop cancels the hold — no menu, and the release click still opens nothing", async () => {
    render(<EditHost />);
    const tile = tileButton("GitHub");
    await act(async () => {
      touch(tile, "pointerdown");
      touch(tile, "pointermove", 90, 42);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(launchApp).not.toHaveBeenCalled();
  });

  it("a quick tap never opens the menu — the app launches through the canonical helper", async () => {
    render(<EditHost />);
    const tile = tileButton("GitHub");
    await act(async () => {
      touch(tile, "pointerdown");
      touch(tile, "pointerup");
      fireEvent.click(tile);
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(launchApp).toHaveBeenCalledTimes(1);
  });

  it("a completed hold swallows the synthesized click on release (no launch under the menu)", async () => {
    render(<EditHost />);
    const tile = tileButton("GitHub");
    await hold(tile);
    await screen.findByRole("menu");
    await act(async () => {
      touch(tile, "pointerup");
      fireEvent.click(tile);
    });
    expect(launchApp).not.toHaveBeenCalled();
  });

  it("a mouse press never triggers the menu (touch-only contract)", async () => {
    render(<EditHost />);
    const tile = tileButton("GitHub");
    await act(async () => {
      dispatchPointer(tile, "pointerdown", { pointerType: "mouse", pointerId: 1, clientX: 40, clientY: 40 });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("the tile menu routes to the shared surfaces (UX-12)", () => {
  async function openMenu(name: string): Promise<HTMLElement> {
    await hold(tileButton(name));
    return await screen.findByRole("menu");
  }

  it("编辑 opens the shared edit dialog (name field prefilled)", async () => {
    render(<EditHost />);
    const menu = await openMenu("GitHub");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: /编辑/ }));
    });
    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText(/名称/) as HTMLInputElement;
    expect(nameField.value).toBe("GitHub");
  });

  it("移到分区 opens the shared move picker listing the OTHER sections", async () => {
    render(<EditHost />);
    const menu = await openMenu("GitHub");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: /移到分区/ }));
    });
    const dialog = await screen.findByRole("dialog");
    const options = within(dialog).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["归档"]);
  });

  it("删除 → confirm → the app is gone and the undo toast restores it", async () => {
    render(<EditHost />);
    const menu = await openMenu("Notion");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: /删除/ }));
    });
    const confirm = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: /删除应用/ }));
    });
    await waitFor(() => {
      expect(() => tileButton("Notion")).toThrow();
    });

    const toast = await screen.findByText(/已删除「Notion」/);
    expect(toast).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(toast.closest(".vela-onboarding-success") as HTMLElement).getByRole("button", { name: /撤销/ }),
      );
    });
    await waitFor(() => {
      expect(tileButton("Notion").textContent).toContain("Notion");
    });
  });
});

describe("the empty section + drawer entries (UX-12)", () => {
  it("the ACTIVE empty section shows the 添加应用 button; neighbour panes stay text-only", async () => {
    render(<EditHost initialPageId="page-b" />);
    const activeSlot = document.querySelector<HTMLElement>('[data-swipe-slot="0"]');
    expect(activeSlot!.textContent).toContain("还没有应用");
    const addButton = within(activeSlot!).getByRole("button", { name: /添加应用/ });
    await act(async () => {
      fireEvent.click(addButton);
    });
    // The shared Add dialog opened, targeted at the active section.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/名称/)).toBeTruthy();
  });

  it("the drawer offers 添加应用 and 管理分区; 管理分区 opens the section manager", async () => {
    render(<EditHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "菜单" }));
    });
    const menuSheet = await screen.findByRole("dialog");
    const manage = within(menuSheet).getByRole("button", { name: /管理分区/ });
    await act(async () => {
      fireEvent.click(manage);
    });
    const manager = await screen.findByText("管理分区");
    const sheet = manager.closest(".vela-mobile-sheet__surface--folder") as HTMLElement;
    expect(sheet).toBeTruthy();
    // One row per section with the desktop's action set (new section on top).
    expect(within(sheet).getByRole("button", { name: /新建分区/ })).toBeTruthy();
    for (const label of [/重命名分区/, /删除分区…/]) {
      expect(within(sheet).getAllByRole("button", { name: label }).length).toBe(2);
    }
    expect(within(sheet).getAllByRole("button", { name: /上移/ }).length).toBe(2);
  });
});
