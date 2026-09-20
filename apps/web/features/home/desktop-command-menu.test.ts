import { describe, expect, it } from "vitest";

import { translate } from "../i18n/messages";
import type { TranslationKey } from "../i18n/messages";
import {
  buildAppMenuEntries,
  buildDesktopCommandEntries,
  buildFolderMenuEntries,
  buildSectionMenuEntries,
} from "./desktop-command-menu";
import type { DesktopMenuEntry } from "./desktop-command-menu";

const noop = () => {};

function commandEntries(overrides: Partial<Parameters<typeof buildDesktopCommandEntries>[0]> = {}) {
  return buildDesktopCommandEntries({
    t: (key: TranslationKey) => translate("zh-CN", key),
    arrange: false,
    canUndo: false,
    canRedo: false,
    syncState: "clean",
    callbacks: {
      onAddApp: noop,
      onNewSection: noop,
      onSearch: noop,
      onToggleMode: noop,
      onUndo: noop,
      onRedo: noop,
      onSync: noop,
      onRefresh: noop,
      onOpenSettings: noop,
      onToggleLocale: noop,
    },
    ...overrides,
  });
}

function actionIds(entries: readonly DesktopMenuEntry[]): string[] {
  return entries.filter((entry): entry is Extract<DesktopMenuEntry, { kind: "action" }> => entry.kind === "action").map((entry) => entry.id);
}

describe("buildDesktopCommandEntries", () => {
  it("always offers add app, new section and search — never new folder", () => {
    const ids = actionIds(commandEntries());
    expect(ids).toContain("add-app");
    expect(ids).toContain("new-section");
    expect(ids).toContain("search");
    expect(ids).not.toContain("new-folder");
  });

  it("labels the arrange toggle by mode: 整理桌面 in view, 退出整理 in arrange", () => {
    const view = commandEntries({ arrange: false });
    const toggleView = view.find((entry) => entry.kind === "action" && entry.id === "toggle-mode");
    expect(toggleView?.kind === "action" && toggleView.label).toBe("整理桌面");

    const arrange = commandEntries({ arrange: true });
    const toggleArrange = arrange.find((entry) => entry.kind === "action" && entry.id === "toggle-mode");
    expect(toggleArrange?.kind === "action" && toggleArrange.label).toBe("退出整理");
  });

  it("hides undo/redo in view mode even when history exists", () => {
    const entries = commandEntries({ arrange: false, canUndo: true, canRedo: true });
    const ids = actionIds(entries);
    expect(ids).not.toContain("undo");
    expect(ids).not.toContain("redo");
  });

  it("shows undo/redo only while arranging with available history", () => {
    const withHistory = commandEntries({ arrange: true, canUndo: true, canRedo: true });
    expect(actionIds(withHistory)).toEqual(expect.arrayContaining(["undo", "redo"]));

    const noHistory = commandEntries({ arrange: true, canUndo: false, canRedo: false });
    const ids = actionIds(noHistory);
    expect(ids).not.toContain("undo");
    expect(ids).not.toContain("redo");
  });

  it("offers 立即同步 when dirty and 从服务器刷新 when clean — never both", () => {
    const dirty = commandEntries({ syncState: "dirty" });
    const dirtyIds = actionIds(dirty);
    expect(dirtyIds).toContain("sync");
    expect(dirtyIds).not.toContain("refresh");

    const clean = commandEntries({ syncState: "clean" });
    const cleanIds = actionIds(clean);
    expect(cleanIds).toContain("refresh");
    expect(cleanIds).not.toContain("sync");
  });

  it("offers no remote action on conflict", () => {
    const entries = commandEntries({ syncState: "conflict" });
    const ids = actionIds(entries);
    expect(ids).not.toContain("sync");
    expect(ids).not.toContain("refresh");
  });

  it("always offers settings and the other-locale toggle", () => {
    const ids = actionIds(commandEntries());
    expect(ids).toContain("open-settings");
    expect(ids).toContain("toggle-locale");
  });

  it("shows English while in Chinese and 中文 while in English", () => {
    const zh = commandEntries();
    const zhToggle = zh.find((entry) => entry.kind === "action" && entry.id === "toggle-locale");
    expect(zhToggle?.kind === "action" && zhToggle.label).toBe("English");

    const en = commandEntries({ t: (key) => translate("en-US", key) });
    const enToggle = en.find((entry) => entry.kind === "action" && entry.id === "toggle-locale");
    expect(enToggle?.kind === "action" && enToggle.label).toBe("中文");
  });

  it("groups the menu with separators (at most three groups)", () => {
    const entries = commandEntries({ arrange: true, canUndo: true, canRedo: true, syncState: "dirty" });
    const separators = entries.filter((entry) => entry.kind === "separator");
    expect(separators).toHaveLength(2);
    // Separators never appear adjacent and never first/last.
    expect(entries[0]!.kind).toBe("action");
    expect(entries[entries.length - 1]!.kind).toBe("action");
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1]!;
      const current = entries[index]!;
      expect(previous.kind === "separator" && current.kind === "separator").toBe(false);
    }
  });

  it("uses English copy when built with the en-US translator", () => {
    const entries = commandEntries({ t: (key: TranslationKey) => translate("en-US", key), syncState: "dirty" });
    const labels = entries
      .filter((entry): entry is Extract<DesktopMenuEntry, { kind: "action" }> => entry.kind === "action")
      .map((entry) => entry.label);
    expect(labels).toContain("Add App");
    expect(labels).toContain("New Section");
    expect(labels).toContain("Arrange Desktop");
    expect(labels).toContain("Settings…");
  });
});

describe("buildAppMenuEntries", () => {
  const base = {
    t: (key: TranslationKey) => translate("zh-CN", key),
    callbacks: {
      onOpen: noop,
      onEdit: noop,
      onEditAppearance: noop,
      onMoveToSection: noop,
      onPinToggle: noop,
      onDelete: noop,
    },
  };

  it("has open/edit, edit-appearance, move-to-section and delete — and NO move-to-folder", () => {
    const entries = buildAppMenuEntries({ ...base, pinned: false });
    const ids = actionIds(entries);
    expect(ids).toEqual([
      "open",
      "edit",
      "edit-appearance",
      "move-to-section",
      "pin-toggle",
      "delete",
    ]);
    expect(ids).not.toContain("move-to-folder");
    expect(ids).not.toContain("move-to-desktop");
  });

  it("offers Edit appearance… right after Edit (task 016-A)", () => {
    const entries = buildAppMenuEntries({ ...base, pinned: false });
    const ids = actionIds(entries);
    expect(ids.indexOf("edit-appearance")).toBe(ids.indexOf("edit") + 1);
    const appearance = entries.find(
      (entry) => entry.kind === "action" && entry.id === "edit-appearance"
    );
    expect(appearance?.kind === "action" && appearance.label).toBe("编辑外观…");
  });

  it("labels the pin toggle by pinned state", () => {
    const unpinned = buildAppMenuEntries({ ...base, pinned: false });
    const pin = unpinned.find((entry) => entry.kind === "action" && entry.id === "pin-toggle");
    expect(pin?.kind === "action" && pin.label).toBe("固定到程序坞");

    const pinned = buildAppMenuEntries({ ...base, pinned: true });
    const unpin = pinned.find((entry) => entry.kind === "action" && entry.id === "pin-toggle");
    expect(unpin?.kind === "action" && unpin.label).toBe("从程序坞移除");
  });

  it("English copy says Move to Section…", () => {
    const entries = buildAppMenuEntries({
      t: (key: TranslationKey) => translate("en-US", key),
      pinned: false,
      callbacks: base.callbacks,
    });
    const move = entries.find((entry) => entry.kind === "action" && entry.id === "move-to-section");
    expect(move?.kind === "action" && move.label).toBe("Move to Section…");
  });
});

describe("buildSectionMenuEntries", () => {
  const base = {
    t: (key: TranslationKey) => translate("zh-CN", key),
    isDefault: false,
    isFirst: false,
    isLast: false,
    isEmpty: true,
    callbacks: { onRename: noop, onSetDefault: noop, onMoveUp: noop, onMoveDown: noop, onDelete: noop },
  };

  it("offers rename, default, both moves and delete for a middle empty section", () => {
    expect(actionIds(buildSectionMenuEntries(base))).toEqual([
      "rename-section",
      "set-default-section",
      "move-section-up",
      "move-section-down",
      "delete-section",
    ]);
  });

  it("hides the default action when the section already is the default", () => {
    const ids = actionIds(buildSectionMenuEntries({ ...base, isDefault: true }));
    expect(ids).not.toContain("set-default-section");
  });

  it("hides move up at the first and move down at the last section", () => {
    const first = actionIds(buildSectionMenuEntries({ ...base, isFirst: true }));
    expect(first).not.toContain("move-section-up");
    expect(first).toContain("move-section-down");

    const last = actionIds(buildSectionMenuEntries({ ...base, isLast: true }));
    expect(last).toContain("move-section-up");
    expect(last).not.toContain("move-section-down");
  });

  it("hides delete for a non-empty section", () => {
    const ids = actionIds(buildSectionMenuEntries({ ...base, isEmpty: false }));
    expect(ids).not.toContain("delete-section");
  });
});

describe("buildFolderMenuEntries", () => {
  it("keeps the legacy surface: open, rename, pin toggle, dissolve — no creation/move-into", () => {
    const entries = buildFolderMenuEntries({
      t: (key: TranslationKey) => translate("zh-CN", key),
      pinned: false,
      callbacks: { onOpen: noop, onRename: noop, onPinToggle: noop, onDissolve: noop },
    });
    const ids = actionIds(entries);
    expect(ids).toEqual(["open", "rename", "pin-toggle", "dissolve-folder"]);
    const dissolve = entries.find((entry) => entry.kind === "action" && entry.id === "dissolve-folder");
    expect(dissolve?.kind === "action" && dissolve.label).toBe("解散到当前分区");
  });
});
