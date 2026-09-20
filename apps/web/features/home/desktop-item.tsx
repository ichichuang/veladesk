"use client";

import { useDraggable } from "@dnd-kit/react";
import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { EntityId, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";
import { resolveAppVisualStyle } from "@veladesk/domain";
import type { LayoutItem } from "@veladesk/desktop-engine";

import { contextMenuAnchorFromElement, isContextMenuKeyEvent } from "./context-menu";
import { AppIconTile } from "./app-icon-renderer";
import {
  RESIZE_CORNERS,
  beginResizeSession,
  resizeScaleAt,
} from "./app-resize";
import type { ResizeCorner, ResizeSession } from "./app-resize";
import { launchApp } from "./launch-app";
import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

interface DesktopItemProps {
  readonly item: LayoutItem;
  readonly workspace: WorkspaceSnapshot;
  /** Arrange mode allows dragging; view mode launches/opens on activation. */
  readonly arrange: boolean;
  /**
   * Whether drag sessions may start at all (a pending drop handoff or a
   * live icon resize briefly disables them). Kept separate from `arrange`
   * so the mode stays a pure user-facing concept.
   */
  readonly dragEnabled: boolean;
  readonly metricsAvailable: boolean;
  /** Whether this item is in the session-only arrange selection. */
  readonly selected: boolean;
  /**
   * Whether this item shows the four corner resize handles. The shell
   * decides (single-selection app in arrange mode); the item only adds the
   * "not dragging" and "not resizing something else" conditions.
   */
  readonly resizable: boolean;
  /** The app whose resize session or handoff is live, if any. */
  readonly resizeActiveId: EntityId | null;
  readonly onResizeCommit: (entityId: EntityId, scale: number) => void;
  /** Reports a session start/end so the shell can lock competing gestures. */
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
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
  resizable,
  resizeActiveId,
  onResizeCommit,
  onResizeSessionChange,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
}: DesktopItemProps) {
  const { t } = useI18n();
  const entity = workspace.entities.find((candidate) => candidate.id === item.id);
  if (entity === undefined) {
    return (
      <div
        className="vela-item vela-item--missing"
        style={placementStyle(item)}
        title={t("item.missingTitle")}
        onContextMenu={swallowContextMenu}
      >
        <span className="vela-item__label">{t("item.missing")}</span>
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
      resizable={resizable}
      resizeActiveId={resizeActiveId}
      onResizeCommit={onResizeCommit}
      onResizeSessionChange={onResizeSessionChange}
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
  readonly resizable: boolean;
  readonly resizeActiveId: EntityId | null;
  readonly onResizeCommit: DesktopItemProps["onResizeCommit"];
  readonly onResizeSessionChange: DesktopItemProps["onResizeSessionChange"];
  readonly onItemSelect: DesktopItemProps["onItemSelect"];
  readonly onEntityContextMenu: DesktopItemProps["onEntityContextMenu"];
  readonly onOpenFolder: DesktopItemProps["onOpenFolder"];
}

/** A live resize gesture, keyed by the pointer that owns it. */
interface ActiveResize {
  readonly session: ResizeSession;
  readonly pointerId: number;
}

function DesktopEntity({
  item,
  entity,
  arrange,
  dragEnabled,
  metricsAvailable,
  selected,
  resizable,
  resizeActiveId,
  onResizeCommit,
  onResizeSessionChange,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
}: DesktopEntityProps) {
  const { t } = useI18n();
  const { ref, isDragging } = useDraggable({
    id: item.id,
    disabled: !arrange || !dragEnabled || !metricsAvailable,
  });
  /**
   * The wrapper around the icon tile. During a resize the transient scale is
   * written here as a CSS custom property — custom properties inherit, so
   * the tile picks it up without React re-rendering the desktop on every
   * pointer frame.
   */
  const tileWrapRef = useRef<HTMLSpanElement | null>(null);
  const resizeRef = useRef<ActiveResize | null>(null);
  const [resizing, setResizing] = useState(false);

  const commonStyle = { ...placementStyle(item), ...(isDragging ? { zIndex: 30 } : {}) };
  const draggingProps = { "data-dragging": isDragging ? "true" : undefined } as const;

  /**
   * The preview scale is only ever removed while no resize is live for this
   * app: the shell keeps the handoff alive until the persisted snapshot
   * carries the committed scale, so the tile never flashes back to the old
   * size between pointerup and the durable write.
   */
  const resumePreviewHeld = resizeActiveId === entity.id;
  useEffect(() => {
    if (!resumePreviewHeld) {
      tileWrapRef.current?.style.removeProperty("--vd-app-icon-scale-preview");
    }
  }, [resumePreviewHeld]);

  function clearPreview() {
    tileWrapRef.current?.style.removeProperty("--vd-app-icon-scale-preview");
  }

  function endResize() {
    resizeRef.current = null;
    setResizing(false);
    onResizeSessionChange(entity.id, false);
  }

  function cancelResize() {
    if (resizeRef.current === null) {
      return;
    }
    clearPreview();
    endResize();
  }

  function handleResizePointerDown(corner: ResizeCorner) {
    return (event: ReactPointerEvent<HTMLSpanElement>) => {
      // Never let a handle start a drag, a marquee, a launch or a menu.
      //
      // This MUST run in the CAPTURE phase: dnd-kit attaches its own native
      // pointerdown listener to the draggable button, and a native listener on
      // the button fires before React's root-level bubble handlers — stopping
      // propagation from a bubble handler would be too late and the tile would
      // start dragging instead of resizing. Stopping it at the root during
      // capture keeps the event away from the button entirely.
      event.preventDefault();
      event.stopPropagation();
      if (resizeRef.current !== null) {
        return;
      }
      const tile = tileWrapRef.current?.querySelector<HTMLElement>(".vela-item__icon");
      if (tile === null || tile === undefined) {
        return;
      }
      const rect = tile.getBoundingClientRect();
      const session = beginResizeSession({
        corner,
        startScale: appScale,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        pointerX: event.clientX,
        pointerY: event.clientY,
      });
      if (session === undefined) {
        return;
      }
      resizeRef.current = { session, pointerId: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizing(true);
      onResizeSessionChange(entity.id, true);
    };
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const active = resizeRef.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const next = resizeScaleAt(active.session, event.clientX, event.clientY);
    tileWrapRef.current?.style.setProperty("--vd-app-icon-scale-preview", String(next));
  }

  function handleResizePointerUp(event: ReactPointerEvent<HTMLSpanElement>) {
    const active = resizeRef.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const finalScale = resizeScaleAt(active.session, event.clientX, event.clientY);
    // Pointer capture stays until the browser releases it; the gesture is
    // over for us either way.
    endResize();
    // The transient preview REMAINS at finalScale — the shell either hands it
    // off to the durable snapshot or drops it (no-op / failure), and the
    // effect above removes it exactly then.
    onResizeCommit(entity.id, finalScale);
  }

  /** Capture lost without a pointerup (OS gesture, element detach): cancel. */
  function handleLostPointerCapture(event: ReactPointerEvent<HTMLSpanElement>) {
    if (resizeRef.current?.pointerId === event.pointerId) {
      cancelResize();
    }
  }

  // Escape cancels a live resize (spec: no stage, no sync, persisted scale
  // untouched). Registered only while this item owns the gesture.
  useEffect(() => {
    if (!resizing) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelResize();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelResize only touches refs and stable setters
  }, [resizing]);

  const showResizeHandles =
    entity.kind === "app" &&
    resizable &&
    !isDragging &&
    (resizeActiveId === null || resizeActiveId === entity.id);
  /**
   * The gesture starts from the AUTHORITATIVE scale, never from whatever the
   * preview happens to show — the shell hides the handles while a handoff is
   * live, so a session can never begin on a pending value.
   */
  const appScale = entity.kind === "app" ? resolveAppVisualStyle(entity).iconScale : 1;

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
        <span className="vela-item__icon-wrap" ref={tileWrapRef}>
          <AppIconTile app={entity} />
          {showResizeHandles
            ? RESIZE_CORNERS.map((corner) => (
                <span
                  key={corner}
                  className="vela-item__resize-handle"
                  data-corner={corner}
                  role="button"
                  aria-label={t("arrange.resizeIcon")}
                  onPointerDownCapture={handleResizePointerDown(corner)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleLostPointerCapture}
                  onLostPointerCapture={handleLostPointerCapture}
                  onClick={(event) => {
                    // The click a handle produces belongs to the resize.
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onContextMenu={swallowContextMenu}
                />
              ))
            : null}
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
