import { describe, expect, it } from "vitest";

import type {
  AppShortcut,
  Folder,
  WidgetInstance,
  WorkspaceEntity,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import { buildLauncherEntries } from "./launcher-index";
import { searchLauncherEntries } from "./launcher-search";

interface AppOptions {
  readonly url?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly categoryId?: string;
}

function app(id: string, name: string, options: AppOptions = {}): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: options.url ?? "https://example.com/",
    ...(options.description !== undefined ? { description: options.description } : {}),
    icon: { kind: "generated", text: name.slice(0, 2).toUpperCase() },
    openMode: "new-tab",
    ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {}),
    tags: options.tags ?? [],
  };
}

function folder(id: string, name: string, children: readonly string[]): Folder {
  return { kind: "folder", id, name, children };
}

function widget(id: string): WidgetInstance {
  return {
    kind: "widget",
    id,
    widgetType: "builtin.clock",
    config: {},
  };
}

interface PageSpec {
  readonly id: string;
  readonly name: string;
  readonly itemIds: readonly string[];
}

function workspace(
  entities: readonly WorkspaceEntity[],
  pages: readonly PageSpec[],
  dockItems: readonly string[],
  categories: readonly { id: string; name: string }[] = [],
): WorkspaceSnapshot {
  return {
    id: "workspace-1",
    name: "Desk",
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      layout: {
        id: page.id,
        grid: { columns: 6, rows: 4 },
        items: page.itemIds.map((itemId, index) => ({
          id: itemId,
          position: { column: index % 6, row: Math.floor(index / 6) },
          span: { columns: 1, rows: 1 },
        })),
      },
    })),
    entities,
    categories,
    dock: { items: dockItems },
    preferences: { defaultPageId: pages[0]?.id ?? "page", layoutLocked: false },
  };
}

const richEntities: readonly WorkspaceEntity[] = [
  app("app-openai", "OpenAI", { url: "https://openai.com" }),
  app("app-github", "GitHub", {
    url: "https://github.com",
    tags: ["code", "git"],
    categoryId: "cat-dev",
  }),
  app("app-notes", "Notes", { url: "obsidian://open?vault=Notes" }),
  app("app-calendar", "Calendar"),
  folder("folder-tools", "Tools", ["app-notes"]),
  widget("widget-clock"),
];

const richPages: readonly PageSpec[] = [
  { id: "page-home", name: "Home", itemIds: ["app-openai", "app-github", "folder-tools", "widget-clock"] },
  { id: "page-work", name: "Work", itemIds: ["app-calendar"] },
];

function richInput(
  overrides: Partial<Parameters<typeof buildLauncherEntries>[0]> = {},
): Parameters<typeof buildLauncherEntries>[0] {
  return {
    workspace: workspace(richEntities, richPages, ["app-openai", "folder-tools"], [
      { id: "cat-dev", name: "Development" },
    ]),
    activePageId: "page-home",
    mode: "view",
    syncState: "clean",
    locale: "en-US",
    ...overrides,
  };
}

function keysOf(input: Parameters<typeof buildLauncherEntries>[0]): readonly string[] {
  return buildLauncherEntries(input).map((entry) => entry.key);
}

describe("buildLauncherEntries — entity scope", () => {
  it("indexes every app: desktop, dock-only, folder child and unplaced", () => {
    const keys = keysOf(richInput());
    expect(keys).toContain("app:app-openai");
    expect(keys).toContain("app:app-notes");
    expect(keys).toContain("app:app-calendar");
    expect(keys).toContain("app:app-github");
  });

  it("indexes the folder child app even though it is not on any page layout", () => {
    const entry = buildLauncherEntries(richInput()).find(
      (candidate) => candidate.kind === "app" && candidate.entityId === "app-notes",
    );
    expect(entry?.label).toBe("Notes");
  });

  it("indexes unplaced apps that are neither docked nor on a page", () => {
    const isolated = workspace([app("app-solo", "Solo")], [{ id: "page-1", name: "Home", itemIds: [] }], []);
    const keys = keysOf({
      workspace: isolated,
      activePageId: "page-1",
      mode: "view",
      syncState: "clean",
      locale: "en-US",
    });
    expect(keys).toEqual([
      "command:add-app",
      "command:new-section",
      "command:open-settings",
      "command:toggle-mode",
      "command:pull-current",
      "app:app-solo",
      "page:page-1",
    ]);
  });

  it("indexes folders even when they are not on the active page", () => {
    const keys = keysOf(richInput({ activePageId: "page-work" }));
    expect(keys).toContain("folder:folder-tools");
  });

  it("indexes all pages with page:<id> keys", () => {
    const keys = keysOf(richInput());
    expect(keys).toContain("page:page-home");
    expect(keys).toContain("page:page-work");
  });

  it("never indexes widgets", () => {
    const entries = buildLauncherEntries(richInput());
    expect(entries.some((entry) => entry.key.includes("widget"))).toBe(false);
  });

  it("resolves the category name into app search metadata", () => {
    const entry = buildLauncherEntries(richInput()).find(
      (candidate) => candidate.kind === "app" && candidate.entityId === "app-github",
    );
    if (entry?.kind !== "app") {
      throw new Error("expected an app entry");
    }
    expect(entry.secondary).toContain("Development");
    expect(entry.secondary).toContain("code");
    expect(entry.secondary).toContain("https://github.com");
    expect(entry.secondary).toContain("app");
  });

  it("omits category metadata when the categoryId does not resolve", () => {
    const orphaned = workspace(
      [app("app-x", "X", { categoryId: "cat-missing" })],
      [{ id: "page-1", name: "Home", itemIds: [] }],
      [],
    );
    const entry = buildLauncherEntries({
      workspace: orphaned,
      activePageId: "page-1",
      mode: "view",
      syncState: "clean",
      locale: "en-US",
    }).find((candidate) => candidate.kind === "app");
    if (entry?.kind !== "app") {
      throw new Error("expected an app entry");
    }
    expect(entry.secondary).not.toContain("cat-missing");
  });
});

describe("buildLauncherEntries — empty-query ordering", () => {
  it("orders commands first, then dock, active page, remaining entities, pages", () => {
    const keys = keysOf(richInput({ syncState: "conflict" }));
    expect(keys).toEqual([
      "command:add-app",
      "command:new-section",
      "command:open-settings",
      "command:toggle-mode",
      "app:app-openai",
      "folder:folder-tools",
      "app:app-github",
      "app:app-notes",
      "app:app-calendar",
      "page:page-home",
      "page:page-work",
    ]);
  });

  it("follows the strict workspace.dock.items order", () => {
    const flipped = workspace(richEntities, richPages, ["folder-tools", "app-openai"]);
    const keys = keysOf({
      workspace: flipped,
      activePageId: "page-home",
      mode: "view",
      syncState: "conflict",
      locale: "en-US",
    });
    expect(keys.indexOf("folder:folder-tools")).toBeLessThan(keys.indexOf("app:app-openai"));
  });

  it("follows the strict active-page layout order after the dock", () => {
    const keys = keysOf(richInput({ syncState: "conflict" }));
    expect(keys.indexOf("app:app-github")).toBeLessThan(keys.indexOf("app:app-notes"));
    expect(keys.indexOf("app:app-github")).toBeGreaterThan(keys.indexOf("folder:folder-tools"));
  });

  it("deduplicates an app that is both docked and on the active page", () => {
    const keys = keysOf(richInput({ syncState: "conflict" }));
    expect(keys.filter((key) => key === "app:app-openai")).toHaveLength(1);
  });

  it("emits remaining entities in workspace.entities order", () => {
    const keys = keysOf(richInput({ syncState: "conflict" }));
    // Remaining (undocked, off-page) apps follow entities order: Notes before Calendar.
    expect(keys.indexOf("app:app-notes")).toBeLessThan(keys.indexOf("app:app-calendar"));
  });

  it("emits pages after all entities in workspace.pages order", () => {
    const keys = keysOf(richInput({ syncState: "conflict" }));
    expect(keys.indexOf("page:page-home")).toBeGreaterThan(keys.indexOf("app:app-calendar"));
    expect(keys.indexOf("page:page-home")).toBeLessThan(keys.indexOf("page:page-work"));
  });

  it("assigns sequential unique baseOrder values matching the emitted order", () => {
    const entries = buildLauncherEntries(richInput());
    expect(entries.map((entry) => entry.baseOrder)).toEqual(
      entries.map((_, index) => index),
    );
  });

  it("uses stable unique keys of the form kind:<id>", () => {
    const entries = buildLauncherEntries(richInput());
    const keys = entries.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^(app|folder|page|command):/);
    }
  });
});

describe("buildLauncherEntries — commands", () => {
  it("offers Sync Now only for a dirty workspace", () => {
    const keys = keysOf(richInput({ syncState: "dirty" }));
    expect(keys).toContain("command:sync-current");
    expect(keys).not.toContain("command:pull-current");
  });

  it("offers Refresh from Server only for a clean workspace", () => {
    const keys = keysOf(richInput({ syncState: "clean" }));
    expect(keys).toContain("command:pull-current");
    expect(keys).not.toContain("command:sync-current");
  });

  it("offers neither remote command for a conflicted workspace", () => {
    const keys = keysOf(richInput({ syncState: "conflict" }));
    expect(keys).not.toContain("command:sync-current");
    expect(keys).not.toContain("command:pull-current");
  });

  it("labels the mode command by the mode it switches to", () => {
    const arrange = buildLauncherEntries(richInput({ mode: "arrange" }));
    const view = buildLauncherEntries(richInput({ mode: "view" }));
    const arrangeToggle = arrange.find(
      (entry) => entry.kind === "command" && entry.commandId === "toggle-mode",
    );
    const viewToggle = view.find(
      (entry) => entry.kind === "command" && entry.commandId === "toggle-mode",
    );
    expect(arrange.find((e) => e.kind === "command" && e.commandId === "toggle-mode")?.label).toBe(
      "Switch to View",
    );
    expect(viewToggle?.label).toBe("Switch to Arrange");
    expect(arrangeToggle?.label).toBe("Switch to View");
  });

  it("always leads with add-app, new-section, open-settings, toggle-mode in that order", () => {
    const keys = keysOf(richInput({ syncState: "dirty" }));
    expect(keys.slice(0, 5)).toEqual([
      "command:add-app",
      "command:new-section",
      "command:open-settings",
      "command:toggle-mode",
      "command:sync-current",
    ]);
  });

  it("offers the local Settings command regardless of sync state", () => {
    for (const syncState of ["clean", "dirty", "conflict"] as const) {
      const keys = keysOf(richInput({ syncState }));
      expect(keys).toContain("command:open-settings");
    }
  });

  it("finds Settings by its label and metadata keywords", () => {
    for (const query of ["settings", "theme", "preferences", "appearance"]) {
      const results = searchLauncherEntries(buildLauncherEntries(richInput({ syncState: "conflict" })), query);
      expect(results[0]?.key).toBe("command:open-settings");
    }
  });
});

describe("buildLauncherEntries — localization", () => {
  it("labels commands in Chinese and keeps the fixed command order (zh-CN)", () => {
    const entries = buildLauncherEntries(richInput({ locale: "zh-CN", syncState: "dirty" }));
    const commands = entries.filter((entry) => entry.kind === "command");
    expect(commands.map((entry) => entry.label)).toEqual([
      "添加应用",
      "新建分区",
      "设置",
      "切换到整理模式",
      "立即同步",
    ]);
    expect(commands.map((entry) => entry.key)).toEqual([
      "command:add-app",
      "command:new-section",
      "command:open-settings",
      "command:toggle-mode",
      "command:sync-current",
    ]);
  });

  it("labels commands in English and keeps the fixed command order (en-US)", () => {
    const entries = buildLauncherEntries(richInput({ locale: "en-US", syncState: "dirty" }));
    const commands = entries.filter((entry) => entry.kind === "command");
    expect(commands.map((entry) => entry.label)).toEqual([
      "Add App",
      "New Section",
      "Settings",
      "Switch to Arrange",
      "Sync Now",
    ]);
  });

  it("labels the toggle command for arrange mode in Chinese", () => {
    const entries = buildLauncherEntries(richInput({ locale: "zh-CN", mode: "arrange" }));
    const toggle = entries.find(
      (entry) => entry.kind === "command" && entry.commandId === "toggle-mode",
    );
    expect(toggle?.label).toBe("切换到查看模式");
  });

  it("finds the Settings command from Chinese queries", () => {
    for (const query of ["设置", "外观", "主题"]) {
      const results = searchLauncherEntries(
        buildLauncherEntries(richInput({ locale: "zh-CN", syncState: "conflict" })),
        query,
      );
      expect(results[0]?.key).toBe("command:open-settings");
    }
  });

  it("finds the Settings command from English queries", () => {
    const results = searchLauncherEntries(
      buildLauncherEntries(richInput({ locale: "zh-CN", syncState: "conflict" })),
      "settings",
    );
    expect(results[0]?.key).toBe("command:open-settings");
  });

  it("searches across languages: Chinese keyword finds the sync command in English UI", () => {
    const results = searchLauncherEntries(
      buildLauncherEntries(richInput({ locale: "en-US", syncState: "dirty" })),
      "同步",
    );
    expect(results[0]?.key).toBe("command:sync-current");
  });

  it("searches across languages: English keyword finds a folder in Chinese UI", () => {
    const results = searchLauncherEntries(
      buildLauncherEntries(richInput({ locale: "zh-CN" })),
      "folder",
    );
    expect(results.map((entry) => entry.key)).toContain("folder:folder-tools");
  });

  it("never translates user data labels (app, folder, page names)", () => {
    const entries = buildLauncherEntries(richInput({ locale: "zh-CN" }));
    const labels = entries.filter((e) => e.kind !== "command").map((e) => e.label);
    expect(labels).toContain("OpenAI");
    expect(labels).toContain("Tools");
    expect(labels).toContain("Home");
  });
});
