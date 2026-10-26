// @vitest-environment jsdom
import { runtimeManagementStub } from "../../workspace-runtime/test-runtime-management";
/*
 * Task 026 §74/§75/§80 — the mobile shell's read-only contract and browse
 * surface: the exact management strings never render (not disabled —
 * absent), the derived grid renders tiles with always-visible names, and
 * the wallpaper chain follows the active section through the shared
 * resolver. A DOM-emulated render proves structure, never painted pixels.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type {
  AppShortcut,
  DesktopPage,
  Folder,
  WidgetInstance,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { WorkspaceRuntimeContextProvider } from "../../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../../i18n/ui-locale-provider";
import { launchApp } from "../launch-app";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { MobileShell } from "./mobile-shell";

vi.mock("../launch-app", () => ({ launchApp: vi.fn() }));

function app(id: string, name: string, visual?: AppShortcut["visual"]): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: `https://${id}.example.com/`,
    icon: { kind: "generated", text: name.slice(0, 2) },
    openMode: "new-tab",
    tags: [],
    ...(visual === undefined ? {} : { visual }),
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

function mobileWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-m",
    workspaceName: "我的 VelaDesk",
    pageId: "page-a",
    pageName: "办公",
    grid: { columns: 6, rows: 4 },
  });
  const page = (id: string, name: string, items: readonly { id: string; column: number; row: number }[], wallpaper?: DesktopPage["wallpaper"]): DesktopPage => ({
    id,
    name,
    layout: { id, grid: { columns: 6, rows: 4 }, items: [] },
    canvas: gridCanvas(items),
    ...(wallpaper === undefined ? {} : { wallpaper }),
  });
  return {
    ...base,
    pages: [
      page("page-a", "办公", [
        { id: "app-github", column: 0, row: 0 },
        { id: "app-notion", column: 1, row: 0 },
        { id: "folder-tools", column: 0, row: 1 },
      ]),
      // A section override — §80: switching tabs must re-resolve.
      page("page-b", "AI", [
        { id: "app-chatgpt", column: 0, row: 0 },
        { id: "app-claude", column: 1, row: 0 },
      ], { kind: "preset", presetId: "dawn" }),
      page("page-c", "娱乐", []),
      // An ASSET-backed override — §46/§80: the shared renderer must carry
      // the asset identity even while the blob URL is still cold.
      page("page-d", "设计", [], { kind: "asset", assetId: "asset-wx", fit: "cover", position: "center" }),
    ],
    entities: [
      app("app-github", "GitHub"),
      app("app-notion", "Notion"),
      app("app-chatgpt", "ChatGPT", { decorationStyle: "none", labelVisible: false }),
      app("app-claude", "Claude"),
      { kind: "folder", id: "folder-tools", name: "开发工具", children: ["app-vscode"] } satisfies Folder,
      app("app-vscode", "VS Code"),
      { kind: "widget", id: "widget-1", widgetType: "builtin.clock", config: {} } satisfies WidgetInstance,
    ],
    dock: { items: ["app-github", "folder-tools"] },
  };
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

/** A host that owns the active section like ResponsiveWorkspaceShell does. */
function MobileHost({ initialPageId = "page-a" }: { readonly initialPageId?: string }) {
  const snapshot = mobileWorkspace();
  const [pageId, setPageId] = useState<string | null>(initialPageId);
  const activeSection: WorkspaceActiveSection = {
    activePageId: pageId,
    effectiveActivePageId: pageId ?? snapshot.pages[0]!.id,
    requestActiveSection: (id) => setPageId(id),
    recordScrollTop: () => {},
  };
  return (
    <WorkspaceRuntimeContextProvider value={rejectRuntime}>
      <UiLocaleProvider>
        <MobileShell workspace={makeRecord(snapshot)} activeSection={activeSection} />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("the mobile read-only contract (§74)", () => {
  it("renders NONE of the desktop management affordances — not even disabled", () => {
    render(<MobileHost />);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("整理");
    expect(text).not.toContain("Arrange");
    expect(text).not.toContain("添加应用");
    expect(text).not.toContain("Add App");
    expect(text).not.toContain("新建分区");
    expect(text).not.toContain("New Section");
    expect(text).not.toContain("JSON");
    expect(text).not.toContain("Import");
    expect(text).not.toContain("编辑");
    expect(text).not.toContain("Edit");
    expect(text).not.toContain("删除");
    expect(text).not.toContain("Delete");
    expect(text).not.toContain("Grid gap");
    expect(text).not.toContain("设置");
    expect(text).not.toContain("Settings");
    // No desktop interaction chrome mounts either.
    expect(document.querySelector(".vela-rail")).toBeNull();
    expect(document.querySelector(".vela-arrange-bar")).toBeNull();
    expect(document.querySelector(".vela-dock")).toBeNull();
    expect(document.querySelector("[data-arrange]")).toBeNull();
  });
});

describe("the section swipe strip (R2 §27/§29/§30 → swipe paging)", () => {
  /*
   * The old two-phase "prepared target" coordinator is gone. Paging now
   * runs on a three-slot strip (previous | active | next), all mounted and
   * laid out, driven by ONE transform — that structure is what makes a
   * finger-following, infinitely looping swipe possible. These tests pin
   * the structural contract the gesture depends on; the gesture itself is
   * covered in mobile-section-swipe.test.tsx.
   */

  function slots(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".vela-mobile-swipe-slot"));
  }

  function slotSummary(): { page: string | undefined; slot: string | undefined }[] {
    return slots().map((element) => ({
      page: element.dataset.sectionId,
      slot: element.dataset.swipeSlot,
    }));
  }

  it("mounts the neighbours up-front so a swipe reveals content already laid out (§27)", () => {
    render(<MobileHost />);
    // 办公 is the first of four sections: its previous wraps to the last.
    expect(slotSummary()).toEqual([
      { page: "page-d", slot: "-1" },
      { page: "page-a", slot: "0" },
      { page: "page-b", slot: "1" },
    ]);
  });

  it("re-slots the SAME panes on a switch — the committed page becomes the centre", async () => {
    render(<MobileHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    });
    expect(slotSummary()).toEqual([
      { page: "page-a", slot: "-1" },
      { page: "page-b", slot: "0" },
      { page: "page-c", slot: "1" },
    ]);
  });

  it("keeps off-screen neighbours inert and hidden from assistive tech", () => {
    render(<MobileHost />);
    for (const element of slots()) {
      const isCentre = element.dataset.swipeSlot === "0";
      if (isCentre) {
        expect(element.hasAttribute("inert")).toBe(false);
        expect(element.getAttribute("aria-hidden")).toBeNull();
      } else {
        expect(element.hasAttribute("inert")).toBe(true);
        expect(element.getAttribute("aria-hidden")).toBe("true");
      }
    }
  });

  it("tapping the CURRENT section changes nothing — same slots, no offset", async () => {
    render(<MobileHost />);
    const before = slotSummary();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "办公" }));
    });
    expect(slotSummary()).toEqual(before);
    const strip = document.querySelector<HTMLElement>(".vela-mobile-swipe-strip")!;
    expect(strip.dataset.swipeActive).toBeUndefined();
  });

  it("rapid switch A→B→C lands on C with exactly one active slot (§29)", async () => {
    render(<MobileHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "AI" }));
      fireEvent.click(screen.getByRole("tab", { name: "娱乐" }));
    });
    const active = slots().filter((element) => element.dataset.swipeSlot === "0");
    expect(active).toHaveLength(1);
    expect(active[0]!.dataset.sectionId).toBe("page-c");
    // B is only present as a neighbour, never as the centre.
    expect(slotSummary().map((entry) => entry.page)).toContain("page-b");
    expect(screen.getByRole("tab", { name: "娱乐" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("wallpaper crossfade semantics (R2 §12/§31)", () => {
  function wallpaperSurfaces(): number {
    return document.querySelectorAll(
      ".vela-mobile-shell__wallpaper .vela-wallpaper-surface",
    ).length;
  }

  it("SAME effective wallpaper: ZERO crossfade layers on switch — no over-animation", async () => {
    render(<MobileHost />);
    expect(wallpaperSurfaces()).toBe(1);
    // 办公 and 娱乐 both follow the workspace background — identical
    // semantic identity must not arm the crossfade pair.
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "娱乐" }));
    });
    expect(wallpaperSurfaces()).toBe(1);
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 600);
      });
    });
    expect(wallpaperSurfaces()).toBe(1);
  });

  it("DIFFERENT wallpaper: exactly one crossfade — two layers while it runs, one after", async () => {
    render(<MobileHost />);
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "AI" })); // override: dawn
    });
    // The incoming layer crossfades over the settled one: exactly two.
    expect(wallpaperSurfaces()).toBe(2);
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 700);
      });
    });
    expect(wallpaperSurfaces()).toBe(1);
  });
});

describe("the browse surface (§14/§24/§75)", () => {
  /**
   * The swipe strip mounts the neighbours too (inert, off-screen), so a
   * document-wide query for a tile or an empty hint can match three times
   * over. Everything about "what the user sees" must be scoped to the
   * CENTRE slot — the same rule the shell itself uses.
   */
  function activeSlot(container: HTMLElement = document.body): HTMLElement {
    const slot = container.querySelector<HTMLElement>('.vela-mobile-swipe-slot[data-swipe-slot="0"]');
    if (slot === null) {
      throw new Error("no active slot");
    }
    return slot;
  }

  it("renders a tablist with one tab per section, the active one selected", () => {
    render(<MobileHost />);
    const tablist = screen.getByRole("tablist", { name: "分类" });
    expect(tablist).not.toBeNull();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["办公", "AI", "娱乐", "设计"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("false");
    // The tablist controls a real panel.
    expect(document.getElementById("vela-mobile-section-panel")).not.toBeNull();
  });

  it("renders the section's apps and folders as touch tiles — names ALWAYS visible", () => {
    render(<MobileHost />);
    const panel = activeSlot();
    expect(panel.textContent).toContain("GitHub");
    expect(panel.textContent).toContain("Notion");
    expect(panel.textContent).toContain("开发工具");
    const tiles = panel.querySelectorAll(".vela-mobile-tile__button");
    expect(tiles).toHaveLength(3);
  });

  it("a labelVisible=false desktop app STILL shows its name on mobile (§24)", () => {
    render(<MobileHost initialPageId="page-b" />);
    expect(screen.getByText("ChatGPT")).not.toBeNull();
    expect(screen.getByText("Claude")).not.toBeNull();
  });

  it("exactly ONE tab carries the active state, and a switch moves it (R1 §9)", () => {
    render(<MobileHost initialPageId="page-b" />);
    const selectedOf = () =>
      screen
        .getAllByRole("tab")
        .filter((tab) => tab.getAttribute("aria-selected") === "true")
        .map((tab) => tab.textContent);
    expect(selectedOf()).toEqual(["AI"]);
    fireEvent.click(screen.getByRole("tab", { name: "娱乐" }));
    expect(selectedOf()).toEqual(["娱乐"]);
    // The active-state attribute contract the CSS hierarchy keys on.
    expect(screen.getByRole("tab", { name: "娱乐" }).tagName).toBe("BUTTON");
  });

  it("long app names share one label class with a two-line block (R1 §49)", () => {
    const longWorkspace = (() => {
      const snapshot = mobileWorkspace();
      const appNames: Record<string, string> = {
        "app-notion": "Home Assistant",
        "app-github": "Microsoft Remote Desktop",
        "app-vscode": "Very Very Very Very Long Internal Dashboard Name",
      };
      return {
        ...snapshot,
        entities: snapshot.entities.map((entity) =>
          entity.kind === "app" && appNames[entity.id] !== undefined
            ? { ...entity, name: appNames[entity.id]! }
            : entity,
        ),
      };
    })();
    // Put all three long-named apps on the visible page.
    const withItems: WorkspaceSnapshot = {
      ...longWorkspace,
      pages: [
        {
          ...longWorkspace.pages.find((candidate) => candidate.id === "page-a")!,
          canvas: gridCanvas([
            { id: "app-notion", column: 0, row: 0 },
            { id: "app-github", column: 1, row: 0 },
            { id: "app-vscode", column: 2, row: 0 },
          ]),
        },
        ...longWorkspace.pages.filter((candidate) => candidate.id !== "page-a"),
      ],
    };
    function LongHost() {
      const [pageId, setPageId] = useState<string | null>("page-a");
      const activeSection: WorkspaceActiveSection = {
        activePageId: pageId,
        effectiveActivePageId: pageId ?? withItems.pages[0]!.id,
        requestActiveSection: (id) => setPageId(id),
        recordScrollTop: () => {},
      };
      return (
        <WorkspaceRuntimeContextProvider value={rejectRuntime}>
          <UiLocaleProvider>
            <MobileShell workspace={makeRecord(withItems)} activeSection={activeSection} />
          </UiLocaleProvider>
        </WorkspaceRuntimeContextProvider>
      );
    }
    render(<LongHost />);
    const panel = activeSlot();
    const labels = panel.querySelectorAll(".vela-mobile-tile__label");
    expect(labels).toHaveLength(3);
    const classes = new Set(Array.from(labels).map((label) => label.className));
    expect(classes.size).toBe(1);
    expect(panel.textContent).toContain("Home Assistant");
    expect(panel.textContent).toContain("Microsoft Remote Desktop");
    expect(panel.textContent).toContain("Very Very Very Very Long Internal Dashboard Name");
  });

  it("an empty section shows the quiet empty hint, never management affordances", () => {
    render(<MobileHost initialPageId="page-c" />);
    expect(activeSlot().textContent).toContain("这个分类还没有应用");
  });

  it("tapping an app launches through the canonical helper — exactly once (§26)", () => {
    render(<MobileHost />);
    fireEvent.click(screen.getByText("GitHub"));
    expect(launchApp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(launchApp).mock.calls[0]![0].name).toBe("GitHub");
  });

  it("switching tabs swaps the section and re-resolves the wallpaper chain (§44/§80)", () => {
    const { container } = render(<MobileHost />);
    const wallpaperOf = () =>
      container.querySelector(".vela-mobile-shell__wallpaper")?.getAttribute(
        "data-wallpaper-provenance",
      );
    // No override on 办公: the workspace background resolves.
    expect(wallpaperOf()).not.toBe("section");
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    expect(screen.getByText("ChatGPT")).not.toBeNull();
    // AI carries a section override — the same shared resolver marks it.
    expect(wallpaperOf()).toBe("section");
  });

  it("the header shows the workspace name and the sync whisper renders nothing when clean (§12/§13)", () => {
    render(<MobileHost />);
    expect(screen.getByText("我的 VelaDesk")).not.toBeNull();
    expect(screen.getByRole("button", { name: "搜索" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "菜单" })).not.toBeNull();
    expect(document.querySelector(".vela-mobile-header__sync")).toBeNull();
  });

  it("an asset-backed section wallpaper flows through the shared renderer (§46/§80)", () => {
    const { container } = render(<MobileHost initialPageId="page-d" />);
    // The shared WallpaperSurface carries the asset identity (and its fit)
    // even while the blob URL is still cold — the neutral canvas shows.
    const imageSurface = container.querySelector('[data-wallpaper-image="asset-wx"]');
    expect(imageSurface).not.toBeNull();
    expect(imageSurface!.closest('[data-wallpaper-fit="cover"]')).not.toBeNull();
  });
});
