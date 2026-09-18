"use client";

import { useDraggable } from "@dnd-kit/react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { AppShortcut, EntityId, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";
import type { LayoutItem } from "@veladesk/desktop-engine";

import { contextMenuAnchorFromElement, isContextMenuKeyEvent } from "./context-menu";
import { generatedIconText } from "./generated-icon";
import { launchApp } from "./launch-app";
import "./home-shell.css";

interface DesktopItemProps {
  readonly item: LayoutItem;
  readonly workspace: WorkspaceSnapshot;
  /** Arrange mode allows dragging; view mode launches/opens on activation. */
  readonly arrange: boolean;
  /**
   * Whether drag sessions may start at all (a pending drop handoff briefly
   * disables them). Kept separate from `arrange` so the mode stays a pure
   * user-facing concept.
   */
  readonly dragEnabled: boolean;
  readonly metricsAvailable: boolean;
  /** Whether this item is in the session-only arrange selection. */
  readonly selected: boolean;
  /** Arrange-mode click: plain selects, Cmd/Ctrl toggles (shell decides). */
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (
    entityId: EntityId,
    x: number,
    y: number
  ) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
}

/**
 * One desktop entity (app, folder or widget) placed on the page grid.
 *
 * Apps are buttons: native focus and Enter/Space keep launch accessible in
 * view mode, while dnd-kit's keyboard sensor owns drag gestures in arrange
 * mode. View-mode clicks launch apps / open folders; arrange-mode clicks
 * drive the session selection. Right-click and Shift+F10 / ContextMenu open
 * the shared entity context menu for apps and folders; a missing entity
 * renders a restrained placeholder instead of crashing the desktop.
 */
export function DesktopItem({
  item,
  workspace,
  arrange,
  dragEnabled,
  metricsAvailable,
  selected,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
}: DesktopItemProps) {
  const entity = workspace.entities.find((candidate) => candidate.id === item.id);
  if (entity === undefined) {
    return (
      <div
        className="vela-item vela-item--missing"
        style={placementStyle(item)}
        title="This item references a missing entity"
        onContextMenu={swallowContextMenu}
      >
        <span className="vela-item__label">Missing item</span>
      </div>
    );
  }
  return (
    <DesktopEntity
      item={item}
      entity={entity}
      arrange={arrange}
      dragEnabled={dragEnabled}
      metricsAvailable={metricsAvailable}
      selected={selected}
      onItemSelect={onItemSelect}
      onEntityContextMenu={onEntityContextMenu}
      onOpenFolder={onOpenFolder}
    />
  );
}

function swallowContextMenu(event: ReactMouseEvent) {
  // Entities must never bubble into the empty-desktop context menu.
  event.preventDefault();
  event.stopPropagation();
}

interface DesktopEntityProps {
  readonly item: LayoutItem;
  readonly entity: WorkspaceEntity;
  readonly arrange: boolean;
  readonly dragEnabled: boolean;
  readonly metricsAvailable: boolean;
  readonly selected: boolean;
  readonly onItemSelect: DesktopItemProps["onItemSelect"];
  readonly onEntityContextMenu: DesktopItemProps["onEntityContextMenu"];
  readonly onOpenFolder: DesktopItemProps["onOpenFolder"];
}

function DesktopEntity({
  item,
  entity,
  arrange,
  dragEnabled,
  metricsAvailable,
  selected,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
}: DesktopEntityProps) {
  const { ref, isDragging } = useDraggable({
    id: item.id,
    disabled: !arrange || !dragEnabled || !metricsAvailable,
  });

  const commonStyle = { ...placementStyle(item), ...(isDragging ? { zIndex: 30 } : {}) };
  const draggingProps = { "data-dragging": isDragging ? "true" : undefined } as const;

  function handleContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onEntityContextMenu(entity.id, event.clientX, event.clientY);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onEntityContextMenu(entity.id, anchor.x, anchor.y);
  }

  function handleClick(event: ReactMouseEvent<HTMLElement>) {
    if (!arrange) {
      // View mode: apps launch, folders open. Widgets have no activation.
      if (entity.kind === "app") {
        launchApp(entity);
      } else if (entity.kind === "folder") {
        onOpenFolder(entity.id);
      }
      return;
    }
    // Arrange mode reserves clicks for the session selection. A plain click
    // selects only this item; Cmd/Ctrl toggles it in or out.
    onItemSelect(entity.id, event.metaKey || event.ctrlKey);
  }

  const selectionProps = { "data-selected": selected ? "true" : undefined } as const;

  if (entity.kind === "app") {
    return (
      <button
        type="button"
        ref={ref}
        data-item-id={item.id}
        className="vela-item"
        data-kind="app"
        {...draggingProps}
        {...selectionProps}
        style={commonStyle}
        title={entity.name}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        <span className="vela-item__icon" aria-hidden="true">
          {appIconText(entity)}
        </span>
        <span className="vela-item__label">{entity.name}</span>
      </button>
    );
  }

  if (entity.kind === "folder") {
    return (
      <button
        type="button"
        ref={ref}
        data-item-id={item.id}
        className="vela-item"
        data-kind="folder"
        {...draggingProps}
        {...selectionProps}
        style={commonStyle}
        title={entity.name}
        aria-haspopup="dialog"
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        <span className="vela-item__icon vela-item__icon--folder" aria-hidden="true">
          <FolderGlyph />
        </span>
        <span className="vela-item__label">{entity.name}</span>
      </button>
    );
  }

  return (
    <div
      ref={ref}
      data-item-id={item.id}
      className="vela-item vela-item--widget"
      data-kind="widget"
      {...draggingProps}
      {...selectionProps}
      style={commonStyle}
      tabIndex={0}
      onContextMenu={swallowContextMenu}
      onClick={handleClick}
    >
      <span className="vela-item__widget-title">{entity.title ?? entity.widgetType}</span>
    </div>
  );
}

function placementStyle(item: LayoutItem): React.CSSProperties {
  return {
    gridColumn: `${item.position.column + 1} / span ${item.span.columns}`,
    gridRow: `${item.position.row + 1} / span ${item.span.rows}`,
  };
}

function appIconText(app: AppShortcut): string {
  // Favicon/iconify/asset icons intentionally render the generated fallback
  // in v1 — no icon fetching or runtimes in this task.
  if (app.icon.kind === "generated") {
    return app.icon.text.trim().length > 0 ? app.icon.text : generatedIconText(app.name);
  }
  return generatedIconText(app.name);
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" role="presentation" focusable="false">
      <path
        d="M4 9.5C4 8.1 5.1 7 6.5 7h6l3 3h10c1.4 0 2.5 1.1 2.5 2.5v11c0 1.4-1.1 2.5-2.5 2.5h-19C5.1 26 4 24.9 4 23.5v-14Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M4 13h24v1.5H4z"
        fill="var(--vd-bg)"
        opacity="0.35"
      />
    </svg>
  );
}
