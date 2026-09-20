import type { TranslateFn } from "../i18n/use-i18n";
import type { LocalWorkspaceSyncState } from "@veladesk/local-store";

/**
 * One entry of a VelaDesk context menu: a selectable action or a visual
 * separator. Separators are never focusable and never part of keyboard
 * cycling — the ContextMenu primitive skips them by role.
 */
export type DesktopMenuEntry =
  | {
      readonly kind: "action";
      readonly id: string;
      readonly label: string;
      readonly disabled?: boolean;
      readonly onSelect: () => void;
    }
  | {
      readonly kind: "separator";
    };

/** Shared callback surface of the pure menu builders. */
export interface DesktopCommandCallbacks {
  readonly onAddApp: () => void;
  readonly onNewSection: () => void;
  readonly onSearch: () => void;
  readonly onToggleMode: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onSync: () => void;
  readonly onRefresh: () => void;
  readonly onOpenSettings: () => void;
  readonly onToggleLocale: () => void;
}

export interface DesktopCommandInput {
  readonly t: TranslateFn;
  /** True while the arrange session is active. */
  readonly arrange: boolean;
  /** Arrange-history availability — false hides undo/redo entirely. */
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly syncState: LocalWorkspaceSyncState;
  readonly callbacks: DesktopCommandCallbacks;
}

/**
 * Builds the desktop command menu — the primary command surface, shared
 * verbatim by empty-area right-click and the left-nav ⋯ fallback (task 015,
 * one builder for both entry points).
 *
 * At most three groups:
 *   1. add app / new section / search
 *   2. arrange toggle (+ undo/redo only while arranging AND available)
 *   3. the one meaningful remote action, settings, language toggle
 *
 * Unavailable actions are HIDDEN, never stacked up disabled: view mode has
 * no undo/redo, missing history hides the corresponding entry, and a
 * conflict offers no remote action at all.
 */
export function buildDesktopCommandEntries(
  input: DesktopCommandInput
): readonly DesktopMenuEntry[] {
  const { t, arrange, canUndo, canRedo, syncState, callbacks } = input;

  const entries: DesktopMenuEntry[] = [
    { kind: "action", id: "add-app", label: t("menu.addApp"), onSelect: callbacks.onAddApp },
    { kind: "action", id: "new-section", label: t("menu.newSection"), onSelect: callbacks.onNewSection },
    { kind: "action", id: "search", label: t("menu.search"), onSelect: callbacks.onSearch },
    { kind: "separator" },
    {
      kind: "action",
      id: "toggle-mode",
      label: arrange ? t("menu.exitArrange") : t("menu.arrangeDesktop"),
      onSelect: callbacks.onToggleMode,
    },
  ];

  if (arrange && canUndo) {
    entries.push({ kind: "action", id: "undo", label: t("menu.undoArrange"), onSelect: callbacks.onUndo });
  }
  if (arrange && canRedo) {
    entries.push({ kind: "action", id: "redo", label: t("menu.redoArrange"), onSelect: callbacks.onRedo });
  }

  entries.push({ kind: "separator" });
  if (syncState === "dirty") {
    entries.push({ kind: "action", id: "sync", label: t("menu.syncNow"), onSelect: callbacks.onSync });
  }
  if (syncState === "clean") {
    entries.push({
      kind: "action",
      id: "refresh",
      label: t("menu.refreshFromServer"),
      onSelect: callbacks.onRefresh,
    });
  }
  entries.push(
    { kind: "action", id: "open-settings", label: t("menu.settings"), onSelect: callbacks.onOpenSettings },
    {
      kind: "action",
      id: "toggle-locale",
      label: t("menu.otherLocale"),
      onSelect: callbacks.onToggleLocale,
    }
  );

  return entries;
}

export interface AppMenuInput {
  readonly t: TranslateFn;
  /** Whether the app is dock-pinned (decides pin vs unpin). */
  readonly pinned: boolean;
  readonly callbacks: {
    readonly onOpen: () => void;
    readonly onEdit: () => void;
    readonly onMoveToSection: () => void;
    readonly onPinToggle: () => void;
    readonly onDelete: () => void;
  };
}

/**
 * Builds the app context menu (task 015 model): open/edit, then the move
 * and dock group, then delete. The folder-first primary actions are gone —
 * no "Move to Folder", and "Move to Desktop" became "Move to Section…".
 */
export function buildAppMenuEntries(input: AppMenuInput): readonly DesktopMenuEntry[] {
  const { t, pinned, callbacks } = input;
  return [
    { kind: "action", id: "open", label: t("menu.open"), onSelect: callbacks.onOpen },
    { kind: "action", id: "edit", label: t("menu.edit"), onSelect: callbacks.onEdit },
    { kind: "separator" },
    { kind: "action", id: "move-to-section", label: t("menu.moveToSection"), onSelect: callbacks.onMoveToSection },
    {
      kind: "action",
      id: "pin-toggle",
      label: pinned ? t("menu.removeFromDock") : t("menu.pinToDock"),
      onSelect: callbacks.onPinToggle,
    },
    { kind: "separator" },
    { kind: "action", id: "delete", label: t("menu.delete"), onSelect: callbacks.onDelete },
  ];
}

export interface SectionMenuInput {
  readonly t: TranslateFn;
  readonly isDefault: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  /** Only an empty section may be deleted. */
  readonly isEmpty: boolean;
  readonly callbacks: {
    readonly onRename: () => void;
    readonly onSetDefault: () => void;
    readonly onMoveUp: () => void;
    readonly onMoveDown: () => void;
    readonly onDelete: () => void;
  };
}

/**
 * Builds the section-nav context menu. Already-default hides the default
 * action; boundary positions hide the corresponding move; a non-empty
 * section hides delete (consistent — the menu never stacks disabled rows,
 * and there are no nested submenus).
 */
export function buildSectionMenuEntries(input: SectionMenuInput): readonly DesktopMenuEntry[] {
  const { t, isDefault, isFirst, isLast, isEmpty, callbacks } = input;
  const entries: DesktopMenuEntry[] = [
    { kind: "action", id: "rename-section", label: t("menu.renameSection"), onSelect: callbacks.onRename },
  ];
  if (!isDefault) {
    entries.push({
      kind: "action",
      id: "set-default-section",
      label: t("menu.setDefaultSection"),
      onSelect: callbacks.onSetDefault,
    });
  }
  entries.push({ kind: "separator" });
  if (!isFirst) {
    entries.push({ kind: "action", id: "move-section-up", label: t("menu.moveSectionUp"), onSelect: callbacks.onMoveUp });
  }
  if (!isLast) {
    entries.push({ kind: "action", id: "move-section-down", label: t("menu.moveSectionDown"), onSelect: callbacks.onMoveDown });
  }
  if (isEmpty) {
    entries.push(
      { kind: "separator" },
      { kind: "action", id: "delete-section", label: t("menu.deleteSection"), onSelect: callbacks.onDelete }
    );
  }
  return entries;
}

export interface FolderMenuInput {
  readonly t: TranslateFn;
  readonly pinned: boolean;
  readonly callbacks: {
    readonly onOpen: () => void;
    readonly onRename: () => void;
    readonly onPinToggle: () => void;
    readonly onDissolve: () => void;
  };
}

/**
 * Legacy folder menu (task 015 policy): folders stay openable, renamable,
 * pinnable and dissolvable into the current section — creation and
 * move-into are retired from the primary UI, never the data.
 */
export function buildFolderMenuEntries(input: FolderMenuInput): readonly DesktopMenuEntry[] {
  const { t, pinned, callbacks } = input;
  return [
    { kind: "action", id: "open", label: t("menu.open"), onSelect: callbacks.onOpen },
    { kind: "separator" },
    { kind: "action", id: "rename", label: t("menu.rename"), onSelect: callbacks.onRename },
    {
      kind: "action",
      id: "pin-toggle",
      label: pinned ? t("menu.removeFromDock") : t("menu.pinToDock"),
      onSelect: callbacks.onPinToggle,
    },
    { kind: "separator" },
    { kind: "action", id: "dissolve-folder", label: t("menu.dissolveFolder"), onSelect: callbacks.onDissolve },
  ];
}
