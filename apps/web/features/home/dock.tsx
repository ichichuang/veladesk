"use client";

import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import { generatedIconText } from "./generated-icon";
import { launchApp } from "./launch-app";
import "./home-shell.css";

interface DockProps {
  readonly workspace: WorkspaceSnapshot;
  /** Arrange mode relabels the mode utility; drag sessions lock it. */
  readonly arrange: boolean;
  readonly dragging: boolean;
  readonly onToggleMode: () => void;
  /** Opens the shared Create menu (Add App / New Folder) at the anchor. */
  readonly onCreateMenu: (x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
}

/**
 * Floating bottom dock: the workspace's pinned items in stored order, then
 * the utility cluster. Dock apps launch on click in both modes; dock
 * folders open their overlay on click. Right-click / Shift+F10 opens the
 * entity context menu (pin/unpin lives there). Pin order itself is not
 * editable in this stage.
 */
export function Dock({
  workspace,
  arrange,
  dragging,
  onToggleMode,
  onCreateMenu,
  onOpenFolder,
  onEntityContextMenu,
}: DockProps) {
  const { t } = useI18n();

  const dockEntities = workspace.dock.items
    .map((entityId) => workspace.entities.find((entity) => entity.id === entityId))
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined)
    .filter((entity) => entity.kind !== "widget");

  function handleEntityContextMenu(event: ReactMouseEvent, entityId: EntityId) {
    event.preventDefault();
    event.stopPropagation();
    onEntityContextMenu(entityId, event.clientX, event.clientY);
  }

  function handleEntityKeyDown(event: ReactKeyboardEvent<HTMLElement>, entityId: EntityId) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onEntityContextMenu(entityId, anchor.x, anchor.y);
  }

  function handleCreate(event: ReactMouseEvent<HTMLButtonElement>) {
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onCreateMenu(anchor.x, anchor.y);
  }

  function handleCreateKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onCreateMenu(anchor.x, anchor.y);
  }

  return (
    <nav className="vela-dock" aria-label={t("dock.label")}>
      {dockEntities.map((entity) =>
        entity.kind === "app" ? (
          <button
            key={entity.id}
            type="button"
            className="vela-dock__item"
            title={entity.name}
            aria-label={t("dock.openApp", { name: entity.name })}
            onClick={() => launchApp(entity)}
            onContextMenu={(event) => handleEntityContextMenu(event, entity.id)}
            onKeyDown={(event) => handleEntityKeyDown(event, entity.id)}
          >
            {generatedIconText(entity.name)}
          </button>
        ) : (
          <button
            key={entity.id}
            type="button"
            className="vela-dock__item vela-dock__item--folder"
            title={entity.name}
            aria-label={t("dock.openFolder", { name: entity.name })}
            aria-haspopup="dialog"
            onClick={() => onOpenFolder(entity.id)}
            onContextMenu={(event) => handleEntityContextMenu(event, entity.id)}
            onKeyDown={(event) => handleEntityKeyDown(event, entity.id)}
          >
            {generatedIconText(entity.name)}
          </button>
        )
      )}

      <span className="vela-dock__separator" aria-hidden="true" />
      <button
        type="button"
        className="vela-dock__utility"
        title={t("dock.create")}
        aria-label={t("dock.create")}
        aria-haspopup="menu"
        disabled={dragging}
        onClick={handleCreate}
        onKeyDown={handleCreateKeyDown}
      >
        +
      </button>
      <button
        type="button"
        className="vela-dock__utility vela-dock__utility--text"
        title={arrange ? t("dock.switchToViewTitle") : t("dock.switchToArrangeTitle")}
        aria-pressed={arrange}
        disabled={dragging}
        onClick={onToggleMode}
      >
        {arrange ? t("mode.view") : t("mode.arrange")}
      </button>
    </nav>
  );
}
