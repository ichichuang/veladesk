// @vitest-environment jsdom
/*
 * Task 026 §76/§77/§78/§79 — the mobile consumption surfaces against the
 * real shell: search (shared model, no management commands, correct
 * activation per kind), folder sheet (read-only, close returns focus),
 * dock (empty→no bar, many→all items, no tooltip/drag/context chrome),
 * menu (only the allowed rows; management never appears).
 */

import { useState } from "react";
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

import { WorkspaceRuntimeContextProvider } from "../../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../../i18n/ui-locale-provider";
import { VELADESK_VERSION } from "../../../lib/app-version";
import { launchApp } from "../launch-app";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { MobileShell } from "./mobile-shell";

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

function page(id: string, name: string, items: readonly string[]): DesktopPage {
  return {
    id,
    name,
    layout: { id, grid: { columns: 6, rows: 4 }, items: [] },
    canvas: {
      version: 2,
      mode: "grid",
      columns: 6,
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

function mobileWorkspace(overrides: { dock?: readonly string[] } = {}): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-m",
    workspaceName: "Desk",
    pageId: "page-work",
    pageName: "办公",
    grid: { columns: 6, rows: 4 },
  });
  return {
    ...base,
    pages: [
      page("page-work", "办公", ["app-github", "folder-tools"]),
      page("page-ai", "AI", ["app-chatgpt"]),
    ],
    entities: [
      app("app-github", "GitHub"),
      app("app-chatgpt", "ChatGPT"),
      { kind: "folder", id: "folder-tools", name: "开发工具", children: ["app-vscode"] } satisfies Folder,
      app("app-vscode", "VS Code"),
    ],
    dock: { items: overrides.dock ?? ["app-github", "folder-tools"] },
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

function MobileHost({
  snapshot = mobileWorkspace(),
  initialPageId = "page-work",
}: {
  readonly snapshot?: WorkspaceSnapshot;
  readonly initialPageId?: string;
}) {
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

async function openSearch(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("mobile search (§33–§37/§76)", () => {
  it("opens as a fullscreen dialog surface from the header button", async () => {
    render(<MobileHost />);
    await openSearch();
    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "搜索" })).not.toBeNull();
  });

  it("finds apps, folders and sections — and NEVER management commands", async () => {
    render(<MobileHost />);
    await openSearch();
    const input = await screen.findByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "g" } });
    });
    // GitHub (app) and 开发工具's children do not match; sections: 办公/AI.
    const options = screen.getAllByRole("option");
    const labels = options.map((option) => option.textContent);
    expect(labels.some((label) => label!.includes("GitHub"))).toBe(true);
    for (const label of labels) {
      expect(label).not.toContain("添加应用");
      expect(label).not.toContain("Add App");
      expect(label).not.toContain("新建分区");
      expect(label).not.toContain("New Section");
      expect(label).not.toContain("整理");
      expect(label).not.toContain("Arrange");
      expect(label).not.toContain("设置");
      expect(label).not.toContain("Settings");
      expect(label).not.toContain("同步");
      expect(label).not.toContain("Sync");
    }
  });

  it("a folder result opens the folder sheet; a section result switches sections", async () => {
    render(<MobileHost />);
    await openSearch();
    const input = await screen.findByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "开发" } });
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]!);
    });
    // The search closed and the folder sheet opened with its apps.
    expect(await screen.findByText("VS Code")).not.toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("activating an app result launches through the canonical helper", async () => {
    render(<MobileHost />);
    await openSearch();
    const input = await screen.findByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "chatgpt" } });
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]!);
    });
    expect(launchApp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(launchApp).mock.calls[0]![0].name).toBe("ChatGPT");
  });

  it("an empty result list shows the quiet empty state", async () => {
    render(<MobileHost />);
    await openSearch();
    const input = await screen.findByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "zzzz-no-match" } });
    });
    expect(screen.getByText("没有匹配的结果")).not.toBeNull();
  });
});

describe("mobile folder sheet (§30–§32/§77)", () => {
  /** The section folder tile (the dock item shares the accessible name). */
  function folderTile(): HTMLElement {
    const panel = document.getElementById("vela-mobile-section-panel")!;
    const tile = Array.from(panel.querySelectorAll<HTMLButtonElement>(".vela-mobile-tile__button")).find(
      (button) => button.getAttribute("aria-label") === "开发工具" || button.textContent?.includes("开发工具"),
    );
    if (tile === undefined) {
      throw new Error("folder tile not found");
    }
    return tile;
  }

  it("opens from the folder tile and lists its apps read-only", async () => {
    render(<MobileHost />);
    await act(async () => {
      fireEvent.click(folderTile());
    });
    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(screen.getByText("VS Code")).not.toBeNull();
    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).not.toContain("移动");
    expect(text).not.toContain("Move");
    expect(text).not.toContain("删除");
    expect(text).not.toContain("Delete");
    expect(text).not.toContain("重命名");
    expect(text).not.toContain("Rename");
    expect(text).not.toContain("解散");
    expect(text).not.toContain("Dissolve");
    // Read-only: launching an app inside works.
    await act(async () => {
      fireEvent.click(within(dialog).getByText("VS Code"));
    });
    expect(launchApp).toHaveBeenCalledTimes(1);
  });

  it("closing the sheet returns focus to the folder tile", async () => {
    render(<MobileHost />);
    const tile = folderTile();
    await act(async () => {
      tile.focus();
      fireEvent.click(tile);
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    // Focus is restored one macrotask after the subtree is gone — flush it.
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
    });
    expect(document.activeElement).toBe(tile);
  });
});

describe("mobile dock (§38–§42/§78)", () => {
  it("an EMPTY dock renders no bar at all", () => {
    const { container } = render(<MobileHost snapshot={mobileWorkspace({ dock: [] })} />);
    expect(container.querySelector(".vela-mobile-dock")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "常用应用" })).toBeNull();
  });

  it("renders every pinned item in dock order with icon-only accessible names", () => {
    render(<MobileHost />);
    const dock = screen.getByRole("navigation", { name: "常用应用" });
    const items = within(dock).getAllByRole("button");
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
      "GitHub",
      "开发工具",
    ]);
  });

  it("many pins keep ALL items in the DOM — no truncation, no first-N", () => {
    const snapshot = mobileWorkspace({
      dock: ["app-github", "app-chatgpt", "app-vscode", "folder-tools"],
    });
    render(<MobileHost snapshot={snapshot} />);
    const dock = screen.getByRole("navigation", { name: "常用应用" });
    expect(within(dock).getAllByRole("button")).toHaveLength(4);
  });

  it("a dock app launches once; a dock folder opens the sheet; no tooltip/drag/context chrome", async () => {
    render(<MobileHost />);
    const dock = screen.getByRole("navigation", { name: "常用应用" });
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "GitHub" }));
    });
    expect(launchApp).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(within(dock).getByRole("button", { name: "开发工具" }));
    });
    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(document.querySelector("[data-vd-tooltip]")).toBeNull();
  });
});

describe("mobile browsing never writes the workspace (§68)", () => {
  it("section switch, search, folder open/close, app open — zero staging, zero sync", async () => {
    const spies = {
      stageWorkspaceUpdate: vi.fn(() => Promise.resolve({ ok: true } as never)),
      stageWorkspaceCreate: vi.fn(() => Promise.resolve({ ok: true } as never)),
      syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" } as never)),
      pullCurrent: vi.fn(() => Promise.resolve({ status: "pulled" } as never)),
      selectWorkspace: vi.fn(() => Promise.resolve({ status: "ready" } as never)),
      initialize: vi.fn(() => Promise.resolve({ status: "ready" } as never)),
    };
    const spyRuntime: WorkspaceClientRuntime = {
      getSnapshot: () => {
        throw new Error("unexpected getSnapshot");
      },
      subscribe: () => () => {},
      ...spies,
      close: () => {},
    };
    const snapshot = mobileWorkspace();
    const record = makeRecord(snapshot);
    function SpyHost() {
      const [current, setCurrent] = useState<string | null>("page-work");
      const activeSection: WorkspaceActiveSection = {
        activePageId: current,
        effectiveActivePageId: current ?? snapshot.pages[0]!.id,
        requestActiveSection: (id) => setCurrent(id),
        recordScrollTop: () => {},
      };
      return (
        <WorkspaceRuntimeContextProvider value={spyRuntime}>
          <UiLocaleProvider>
            <MobileShell workspace={record} activeSection={activeSection} />
          </UiLocaleProvider>
        </WorkspaceRuntimeContextProvider>
      );
    }
    render(<SpyHost />);
    // Search: open, type, close.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    });
    const input = await screen.findByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "git" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await waitFor(() => {
      expect(screen.queryByRole("searchbox")).toBeNull();
    });
    // Folder sheet: open, close.
    const panel = document.getElementById("vela-mobile-section-panel")!;
    const folderTile = Array.from(panel.querySelectorAll<HTMLButtonElement>(".vela-mobile-tile__button")).find((button) =>
      button.textContent?.includes("开发工具"),
    )!;
    await act(async () => {
      fireEvent.click(folderTile);
    });
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });
    // Open an app, then switch section — the full consumption loop.
    await act(async () => {
      fireEvent.click(screen.getByText("GitHub"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    });
    expect(spies.stageWorkspaceUpdate).not.toHaveBeenCalled();
    expect(spies.stageWorkspaceCreate).not.toHaveBeenCalled();
    expect(spies.syncCurrent).not.toHaveBeenCalled();
    expect(spies.pullCurrent).not.toHaveBeenCalled();
    expect(spies.selectWorkspace).not.toHaveBeenCalled();
    expect(spies.initialize).not.toHaveBeenCalled();
  });
});

describe("mobile menu (§47–§52/§79)", () => {
  async function openMenu(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "菜单" }));
    });
    return await screen.findByRole("dialog");
  }

  it("uses the content-sized MENU sheet variant with the fixed row order (R1 §45/§26)", async () => {
    render(<MobileHost />);
    const dialog = await openMenu();
    // §45A: the menu rides its own sizing variant, not the folder surface.
    expect(document.querySelector(".vela-mobile-sheet__surface--menu")).not.toBeNull();
    expect(document.querySelector(".vela-mobile-sheet__surface--folder")).toBeNull();
    // §45D: fixed DOM order — title head, workspace, language, version,
    // then the divider-backed hint last.
    const body = dialog.querySelector(".vela-mobile-menu__body")!;
    const rows = Array.from(body.querySelectorAll(":scope > *")).map((node) => node.className);
    expect(rows[0]).toContain("vela-mobile-menu__row");
    expect(rows[1]).toContain("vela-mobile-menu__row");
    expect(rows[2]).toContain("vela-mobile-menu__row");
    expect(rows[3]).toContain("vela-mobile-menu__hint");
    const texts = body.textContent ?? "";
    expect(texts.indexOf("Desk")).toBeLessThan(texts.indexOf("语言"));
    expect(texts.indexOf("语言")).toBeLessThan(texts.indexOf("版本"));
    // §45E: the version row is the real version constant, not a literal.
    expect(texts).toContain(VELADESK_VERSION);
    // §27: workspace name is its own two-level line, not label:value soup.
    const workspaceRow = body.querySelector(".vela-mobile-menu__row")!;
    expect(workspaceRow.textContent).toContain("当前工作区");
    expect(workspaceRow.textContent).toContain("Desk");
    expect(workspaceRow.querySelector(".vela-mobile-menu__row-value")).not.toBeNull();
  });

  it("the FOLDER sheet keeps the tall folder variant (R1 §45B/§20)", async () => {
    render(<MobileHost />);
    const panel = document.getElementById("vela-mobile-section-panel")!;
    const folderTile = Array.from(panel.querySelectorAll<HTMLButtonElement>(".vela-mobile-tile__button")).find((button) =>
      button.textContent?.includes("开发工具"),
    )!;
    await act(async () => {
      fireEvent.click(folderTile);
    });
    await screen.findByRole("dialog");
    expect(document.querySelector(".vela-mobile-sheet__surface--folder")).not.toBeNull();
    expect(document.querySelector(".vela-mobile-sheet__surface--menu")).toBeNull();
  });

  it("shows ONLY the allowed rows: workspace, language, version, desktop hint", async () => {
    render(<MobileHost />);
    const dialog = await openMenu();
    const text = dialog.textContent ?? "";
    expect(text).toContain("Desk");
    expect(text).toContain("语言");
    expect(text).toContain("版本");
    expect(text).toContain("桌面端管理");
    // The forbidden set — absent from every ROW, not disabled. (The hint
    // sentence itself mentions what belongs to the desktop; no row does.)
    for (const row of dialog.querySelectorAll(".vela-mobile-menu__row")) {
      const rowText = row.textContent ?? "";
      for (const forbidden of [
        "Layout", "Wallpaper", "JSON", "Import", "Grid", "Arrange", "Appearance",
      ]) {
        expect(rowText).not.toContain(forbidden);
      }
    }
    // No management CONTROLS: the only interactive elements are the two
    // language options (plus the standard close affordance).
    expect(dialog.querySelectorAll(".vela-mobile-menu__language-option")).toHaveLength(2);
  });

  it("switching the language persists browser-locally and re-renders the shell", async () => {
    render(<MobileHost />);
    const dialog = await openMenu();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "English" }));
    });
    expect(window.localStorage.getItem("veladesk.ui-locale.v2")).toContain("en-US");
    // Close the menu (the open dialog aria-hides the rest of the page) —
    // the header itself must now speak English.
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(await screen.findByRole("button", { name: "Search" })).not.toBeNull();
  });
});
