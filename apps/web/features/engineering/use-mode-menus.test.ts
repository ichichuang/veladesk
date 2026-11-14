import { describe, expect, it } from "vitest";

import { translate } from "../i18n/messages";
import type { TranslationKey } from "../i18n/messages";
import {
  buildAppMenuEntries,
  buildDesktopCommandEntries,
  buildFolderMenuEntries,
} from "../home/desktop-command-menu";
import type { DesktopMenuEntry } from "../home/desktop-command-menu";
import { buildLauncherEntries } from "../home/launcher-index";
import type { AppShortcut, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";

const noop = () => {};

/**
 * t181 Use-mode menu contracts: every editing affordance is INVISIBLE —
 * not disabled — while `engineering: false`, and the consumption surface
 * (打开 / 搜索 / workspace switching) keeps working.
 */

function actionIds(entries: readonly DesktopMenuEntry[]): string[] {
  return entries
    .filter((entry): entry is Extract<DesktopMenuEntry, { kind: "action" }> => entry.kind === "action")
    .map((entry) => entry.id);
}

function submenuIds(entries: readonly DesktopMenuEntry[]): string[] {
  return entries
    .filter((entry): entry is Extract<DesktopMenuEntry, { kind: "submenu" }> => entry.kind === "submenu")
    .map((entry) => entry.id);
}

describe("Use mode: desktop command menu", () => {
  const base = {
    t: (key: TranslationKey) => translate("zh-CN", key),
    arrange: false,
    placementMode: "grid" as const,
    freeformBlockedReason: null,
    canUndo: false,
    canRedo: false,
    syncState: "clean" as const,
    callbacks: {
      onAddApp: noop,
      onNewSection: noop,
      onSearch: noop,
      onToggleMode: noop,
      onSetPlacementMode: noop,
      onUndo: noop,
      onRedo: noop,
      onSync: noop,
      onOpenSettings: noop,
    },
  };

  it("keeps only 搜索 + the workspace submenu", () => {
    const workspaceMenu: DesktopMenuEntry = {
      kind: "submenu",
      id: "workspaces",
      label: "工作区",
      entries: [{ kind: "action", id: "workspace:w1", label: "W", onSelect: noop }],
    };
    const entries = buildDesktopCommandEntries({
      ...base,
      engineering: false,
      workspaceMenu,
    });
    expect(actionIds(entries)).toEqual(["search"]);
    expect(submenuIds(entries)).toEqual(["workspaces"]);
  });

  it("hides add-app, new-section, arrange toggle, undo/redo, placement, sync and settings", () => {
    const entries = buildDesktopCommandEntries({
      ...base,
      engineering: false,
      syncState: "dirty",
    });
    const ids = actionIds(entries);
    for (const forbidden of [
      "add-app",
      "new-section",
      "toggle-mode",
      "undo",
      "redo",
      "placement-grid",
      "placement-freeform",
      "sync",
      "open-settings",
    ]) {
      expect(ids).not.toContain(forbidden);
    }
  });
});

describe("Use mode: entity menus", () => {
  const appCallbacks = {
    onOpen: noop,
    onEdit: noop,
    onEditAppearance: noop,
    onMoveToSection: noop,
    onPinToggle: noop,
    onDelete: noop,
  };

  it("the app menu offers 打开 only", () => {
    const entries = buildAppMenuEntries({
      t: (key: TranslationKey) => translate("zh-CN", key),
      pinned: false,
      engineering: false,
      callbacks: appCallbacks,
    });
    expect(actionIds(entries)).toEqual(["open"]);
  });

  it("the folder menu offers 打开 only", () => {
    const entries = buildFolderMenuEntries({
      t: (key: TranslationKey) => translate("zh-CN", key),
      pinned: false,
      engineering: false,
      callbacks: {
        onOpen: noop,
        onRename: noop,
        onPinToggle: noop,
        onDissolve: noop,
      },
    });
    expect(actionIds(entries)).toEqual(["open"]);
  });
});

describe("Use mode: launcher index", () => {
  function app(id: string, name: string): AppShortcut {
    return {
      kind: "app",
      id,
      name,
      url: "https://example.com/",
      icon: { kind: "generated", text: name.slice(0, 2) },
      openMode: "new-tab",
      tags: [],
    };
  }

  function snapshotWith(entities: readonly WorkspaceEntity[]): WorkspaceSnapshot {
    return {
      id: "w1",
      name: "Desk",
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: 4, rows: 4 },
            items: entities.map((entity, index) => ({
              id: entity.id,
              position: { column: index, row: 0 },
              span: { columns: 1, rows: 1 },
            })),
          },
        },
      ],
      entities,
      categories: [],
      dock: { items: [] },
      preferences: { defaultPageId: "page-1", layoutLocked: false },
    };
  }

  it("keeps workspace SWITCH commands and search targets, drops management commands", () => {
    const entries = buildLauncherEntries({
      workspace: snapshotWith([app("app-1", "Mail")]),
      activePageId: "page-1",
      mode: "view",
      syncState: "clean",
      locale: "zh-CN",
      engineering: false,
      workspaceCandidates: [
        { id: "w1", name: "工作区一" },
        { id: "w2", name: "工作区二" },
      ],
    });
    const commandIds = entries
      .filter((entry) => entry.kind === "command")
      .map((entry) => entry.commandId);
    expect(commandIds).toContain("workspace:w1");
    expect(commandIds).toContain("workspace:w2");
    for (const forbidden of [
      "new-workspace",
      "add-app",
      "new-section",
      "open-settings",
      "toggle-mode",
      "sync-current",
    ]) {
      expect(commandIds).not.toContain(forbidden);
    }
    // Apps and sections remain searchable/launchable.
    expect(entries.some((entry) => entry.kind === "app" && entry.entityId === "app-1")).toBe(true);
    expect(entries.some((entry) => entry.kind === "page")).toBe(true);
  });

  it("still lists management commands in Engineering mode (today's UI)", () => {
    const entries = buildLauncherEntries({
      workspace: snapshotWith([app("app-1", "Mail")]),
      activePageId: "page-1",
      mode: "view",
      syncState: "clean",
      locale: "zh-CN",
      workspaceCandidates: [{ id: "w1", name: "工作区一" }],
    });
    const commandIds = entries
      .filter((entry) => entry.kind === "command")
      .map((entry) => entry.commandId);
    expect(commandIds).toContain("add-app");
    expect(commandIds).toContain("new-section");
    expect(commandIds).toContain("open-settings");
    expect(commandIds).toContain("new-workspace");
  });
});
