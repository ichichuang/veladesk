"use client";

import { useDraggable } from "@dnd-kit/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { EntityId, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";
import type { CanvasLayoutItem, CanvasPlacementMode, CanvasRect, CanvasResizeHandle } from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

import { contextMenuAnchorFromElement, isContextMenuKeyEvent } from "./context-menu";
import { AppIconTile } from "./app-icon-renderer";
import { CANVAS_RESIZE_HANDLES, canvasResizeRectAt, isCanvasResizeNoop } from "../canvas/canvas-resize";
import type { CanvasResizeSession } from "../canvas/canvas-resize";
import { canvasRectStyle } from "../canvas/canvas-style";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import { launchApp } from "./launch-app";
import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

interface DesktopItemProps {
  readonly item: CanvasLayoutItem;
  readonly workspace: WorkspaceSnapshot;
  /** Arrange mode allows dragging and resizing; view mode launches. */
  readonly arrange: boolean;
  /**
   * Whether geometry gestures may start at all (a pending drop handoff or a
   * live resize briefly disables them). Kept separate from `arrange` so the
   * mode stays a pure user-facing concept.
   */
  readonly dragEnabled: boolean;
  /** Canvas pixel metrics; geometry gestures need them to convert pointers. */
  readonly metrics: CanvasPixelMetrics | null;
  readonly grid: GridDefinition;
  readonly placementMode: CanvasPlacementMode;
  /** Whether this item is in the session-only arrange selection. */
  readonly selected: boolean;
  /**
   * Whether this item shows the eight resize handles. The shell decides
   * (single-selection app in arrange mode); the item only adds the "not
   * dragging" and "not resizing something else" conditions.
   */
  readonly resizable: boolean;
  /** The app whose resize session or handoff is live, if any. */
  readonly resizeActiveId: EntityId | null;
  readonly onResizeCommit: (entityId: EntityId, rect: CanvasRect) => void;
  /** Reports a session start/end so the shell can lock competing gestures. */
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  /** Arrange-mode click: plain selects, Cmd/Ctrl toggles (shell decides). */
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
}

/**
 * One desktop entity (app, folder or widget) placed on a page canvas.
 *
 * The item box IS the canvas rect: absolutely positioned in percent space,
 * with the decoration, glyph, label and (in arrange) the resize handles
 * laid out inside it. A rect that is wider than it is tall therefore paints
 * a genuinely rectangular tile — the same code renders a square, a
 * landscape and a portrait app.
 *
 * Apps are buttons: native focus and Enter/Space keep launch accessible in
 * view mode, while dnd-kit's keyboard sensor owns drag gestures in arrange
 * mode. View-mode clicks launch apps / open folders; arrange-mode clicks
 * drive the session selection.
 */
export function DesktopItem({
  item,
  workspace,
  arrange,
  dragEnabled,
  metrics,
  grid,
  placementMode,
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
        style={canvasRectStyle(item.rect)}
        title={t("item.missingTitle")}
        onContextMenu={swallowContextMenu}
      >
        <span className="vela-item__body">
          <span className="vela-item__label">{t("item.missing")}</span>
        </span>
      </div>
    );
  }

  return (
    <DesktopEntity
      item={item}
      entity={entity}
      arrange={arrange}
      dragEnabled={dragEnabled}
      metrics={metrics}
      grid={grid}
      placementMode={placementMode}
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

interface DesktopEntityProps extends Omit<DesktopItemProps, "workspace"> {
  readonly entity: WorkspaceEntity;
}

/** A live resize gesture, keyed by the pointer that owns it. */
interface ActiveResize {
  readonly session: CanvasResizeSession;
  readonly pointerId: number;
}

function DesktopEntity({
  item,
  entity,
  arrange,
  dragEnabled,
  metrics,
  grid,
  placementMode,
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
    disabled: !arrange || !dragEnabled || metrics === null,
  });
  const itemRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<ActiveResize | null>(null);
  const [resizing, setResizing] = useState(false);

  /**
   * The rect the element shows right now, as an inline style. During a
   * resize gesture the preview writes here directly — never through React
   * state — so a pointermove costs no render. Cancel and no-op commits put
   * the authoritative start rect back, because React will not re-apply a
   * style prop that never changed.
   */
  const applyRect = useCallback((rect: CanvasRect) => {
    const element = itemRef.current;
    if (element === null) {
      return;
    }
    const style = canvasRectStyle(rect) as Record<string, string | number>;
    element.style.left = String(style.left);
    element.style.top = String(style.top);
    element.style.width = String(style.width);
    element.style.height = String(style.height);
  }, []);

  function endResize() {
    resizeRef.current = null;
    setResizing(false);
    onResizeSessionChange(entity.id, false);
  }

  function cancelResize() {
    const active = resizeRef.current;
    if (active === null) {
      return;
    }
    applyRect(active.session.startRect);
    endResize();
  }

  function handleResizePointerDown(handle: CanvasResizeHandle) {
    return (event: ReactPointerEvent<HTMLElement>) => {
      // Never let a handle start a drag, a marquee, a launch or a menu.
      //
      // This MUST run in the CAPTURE phase: dnd-kit attaches its own native
      // pointerdown listener to the draggable button, and a native listener
      // on the button fires before React's root-level bubble handlers —
      // stopping propagation from a bubble handler would be too late and the
      // tile would start dragging instead of resizing.
      event.preventDefault();
      event.stopPropagation();
      if (resizeRef.current !== null || metrics === null) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeRef.current = {
        session: {
          handle,
          startRect: item.rect,
          startPointerX: event.clientX,
          startPointerY: event.clientY,
          metrics,
          grid,
          mode: placementMode,
        },
        pointerId: event.pointerId,
      };
      setResizing(true);
      onResizeSessionChange(entity.id, true);
    };
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const active = resizeRef.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    applyRect(
      canvasResizeRectAt(active.session, event.clientX, event.clientY, event.shiftKey),
    );
  }

  function handleResizePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const active = resizeRef.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const finalRect = canvasResizeRectAt(
      active.session,
      event.clientX,
      event.clientY,
      event.shiftKey,
    );
    endResize();
    if (isCanvasResizeNoop(active.session.startRect, finalRect)) {
      // No effective change: no commit, no history entry, no sync — and the
      // preview goes back to the authoritative rect.
      applyRect(active.session.startRect);
      return;
    }
    // The preview STAYS at finalRect: the shell hands it off to the durable
    // snapshot, or drops it (failed stage) — it never flashes back to the
    // old rect in between.
    onResizeCommit(entity.id, finalRect);
  }

  /** Capture lost without a pointerup (OS gesture, element detach): cancel. */
  function handleLostPointerCapture(event: ReactPointerEvent<HTMLElement>) {
    if (resizeRef.current?.pointerId === event.pointerId) {
      cancelResize();
    }
  }

  // Escape cancels a live resize: no stage, no sync, geometry untouched.
  useEffect(() => {
    if (!resizing) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelResize();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancelResize only reads refs and stable setters
  }, [resizing]);

  const showResizeHandles =
    entity.kind === "app" &&
    resizable &&
    !isDragging &&
    metrics !== null &&
    (resizeActiveId === null || resizeActiveId === entity.id);

  const commonStyle: CSSProperties = {
    ...canvasRectStyle(item.rect),
    ...(isDragging ? { zIndex: 30 } : {}),
  };
  const draggingProps = { "data-dragging": isDragging ? "true" : undefined } as const;
  const selectionProps = { "data-selected": selected ? "true" : undefined } as const;

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

  const resizeHandles =
    showResizeHandles && entity.kind === "app" ? (
      <span className="vela-item__resize-layer" aria-hidden="false">
        {CANVAS_RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            className="vela-item__resize-handle"
            data-handle={handle}
            role="button"
            tabIndex={-1}
            aria-label={t("arrange.resizeIcon")}
            onPointerDownCapture={handleResizePointerDown(handle)}
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
        ))}
      </span>
    ) : null;

  if (entity.kind === "app") {
    return (
      <button
        type="button"
        ref={mergeRefs(ref, itemRef)}
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
        <span className="vela-item__body">
          <span className="vela-item__icon-wrap">
            <AppIconTile app={entity} />
          </span>
          <span className="vela-item__label">{entity.name}</span>
        </span>
        {resizeHandles}
      </button>
    );
  }

  if (entity.kind === "folder") {
    return (
      <button
        type="button"
        ref={mergeRefs(ref, itemRef)}
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
        <span className="vela-item__body">
          <span className="vela-item__icon vela-item__icon--folder" aria-hidden="true">
            <FolderGlyph />
          </span>
          <span className="vela-item__label">{entity.name}</span>
        </span>
      </button>
    );
  }

  return (
    <div
      ref={mergeRefs(ref, itemRef)}
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
      <span className="vela-item__body">
        <span className="vela-item__widget-title">{entity.title ?? entity.widgetType}</span>
      </span>
    </div>
  );
}

/**
 * dnd-kit and the resize preview both need the item element — one ref
 * callback feeds both without either owning the other.
 */
function mergeRefs<T>(
  first: (node: T | null) => void,
  second: RefObject<T | null>,
): (node: T | null) => void {
  return (node) => {
    first(node);
    second.current = node;
  };
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 32 32" role="presentation" focusable="false">
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
