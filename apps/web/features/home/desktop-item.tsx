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
import type {
  CanvasLayoutItem,
  CanvasResizeHandle,
  GridCanvasItem,
} from "@veladesk/canvas-engine";

import { contextMenuAnchorFromElement, isContextMenuKeyEvent } from "./context-menu";
import { AppIconTile } from "./app-icon-renderer";
import {
  CANVAS_RESIZE_HANDLES,
  canvasResizeRectAt,
  gridResizeGeometryAt,
  isCanvasResizeNoop,
} from "../canvas/canvas-resize";
import type {
  CanvasResizeSession,
  ResizeCommitGeometry,
} from "../canvas/canvas-resize";
import { canvasRectStyle } from "../canvas/canvas-style";
import { gridPlacementStyle } from "../canvas/square-grid-metrics";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import { launchApp } from "./launch-app";
import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

/** Which geometry model places this item. */
export type ItemGeometry = "grid" | "freeform";

interface DesktopItemProps {
  readonly item: CanvasLayoutItem | GridCanvasItem;
  readonly workspace: WorkspaceSnapshot;
  /** Arrange mode allows dragging and resizing; view mode launches. */
  readonly arrange: boolean;
  /**
   * Whether geometry gestures may start at all (a pending drop handoff or a
   * live resize briefly disables them). Kept separate from `arrange` so the
   * mode stays a pure user-facing concept.
   */
  readonly dragEnabled: boolean;
  /** Freeform: canvas pixel metrics. Grid: null. */
  readonly metrics: CanvasPixelMetrics | null;
  /** Grid: cell pitch. Freeform: null. */
  readonly gridPitchPx: number | null;
  /** Grid: the persistent column count (resize bounds). */
  readonly gridColumns: number | null;
  readonly geometry: ItemGeometry;
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
  readonly onResizeCommit: (entityId: EntityId, geometry: ResizeCommitGeometry) => void;
  /** Reports a session start/end so the shell can lock competing gestures. */
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  /** Arrange-mode click: plain selects, Cmd/Ctrl toggles (shell decides). */
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
}

/**
 * One desktop entity (app, folder or widget) placed on a page.
 *
 * In freeform the item box IS the canvas rect: absolutely positioned in
 * percent space. In grid the item occupies its CSS Grid area
 * (`gridColumn`/`gridRow` from integer cell geometry). Both models share
 * the body: decoration, glyph, label and (in arrange) the eight resize
 * handles laid out inside the item box — a wider-than-tall area paints a
 * genuinely rectangular tile either way.
 *
 * Apps are buttons: native focus and Enter/Space keep launch accessible in
 * view mode, while dnd-kit's keyboard sensor owns drag gestures in arrange
 * mode. View-mode clicks launch apps / open folders; arrange-mode clicks
 * drive the session selection.
 */
export function DesktopItem(props: DesktopItemProps) {
  const { t } = useI18n();
  const entity = props.workspace.entities.find((candidate) => candidate.id === props.item.id);

  if (entity === undefined) {
    return (
      <div
        className="vela-item vela-item--missing"
        style={itemStyle(props.geometry, props.item)}
        title={t("item.missingTitle")}
        onContextMenu={swallowContextMenu}
      >
        <span className="vela-item__body">
          <span className="vela-item__label">{t("item.missing")}</span>
        </span>
      </div>
    );
  }

  return <DesktopEntity {...props} entity={entity} />;
}

/** Inline placement of one item under either geometry model. */
function itemStyle(geometry: ItemGeometry, item: CanvasLayoutItem | GridCanvasItem): CSSProperties {
  if (geometry === "grid") {
    return gridPlacementStyle(item as GridCanvasItem);
  }
  return canvasRectStyle((item as CanvasLayoutItem).rect);
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
  gridPitchPx,
  gridColumns,
  geometry,
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
  const gesturesReady =
    geometry === "grid" ? gridPitchPx !== null && gridColumns !== null : metrics !== null;
  const { ref, isDragging } = useDraggable({
    id: item.id,
    disabled: !arrange || !dragEnabled || !gesturesReady,
  });
  const itemRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<ActiveResize | null>(null);
  const [resizing, setResizing] = useState(false);

  /**
   * The geometry the element shows right now, as inline styles. During a
   * resize gesture the preview writes here directly — never through React
   * state — so a pointermove costs no render. Cancel and no-op commits put
   * the authoritative start geometry back, because React will not re-apply
   * a style prop that never changed.
   */
  const applyGeometry = useCallback(
    (next: ResizeCommitGeometry) => {
      const element = itemRef.current;
      if (element === null) {
        return;
      }
      if (next.kind === "freeform") {
        const style = canvasRectStyle(next.rect) as Record<string, string | number>;
        element.style.gridColumn = "";
        element.style.gridRow = "";
        element.style.left = String(style.left);
        element.style.top = String(style.top);
        element.style.width = String(style.width);
        element.style.height = String(style.height);
        return;
      }
      const style = gridPlacementStyle({ id: item.id, ...next.geometry }) as Record<
        string,
        string | number
      >;
      element.style.left = "";
      element.style.top = "";
      element.style.width = "";
      element.style.height = "";
      element.style.gridColumn = String(style.gridColumn);
      element.style.gridRow = String(style.gridRow);
    },
    [item.id],
  );

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
    applyGeometry(startGeometryOf(active.session));
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
      if (resizeRef.current !== null || !gesturesReady) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      if (geometry === "grid") {
        const gridItem = item as GridCanvasItem;
        resizeRef.current = {
          session: {
            kind: "grid",
            handle,
            itemId: item.id,
            startGeometry: {
              column: gridItem.column,
              row: gridItem.row,
              columnSpan: gridItem.columnSpan,
              rowSpan: gridItem.rowSpan,
            },
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            pitchPx: gridPitchPx ?? 1,
            columns: gridColumns ?? 1,
          },
          pointerId: event.pointerId,
        };
      } else {
        resizeRef.current = {
          session: {
            kind: "freeform",
            handle,
            startRect: (item as CanvasLayoutItem).rect,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            metrics: metrics!,
          },
          pointerId: event.pointerId,
        };
      }
      setResizing(true);
      onResizeSessionChange(entity.id, true);
    };
  }

  function previewGeometryAt(
    session: CanvasResizeSession,
    pointerX: number,
    pointerY: number,
    shiftKey: boolean,
  ): ResizeCommitGeometry {
    if (session.kind === "grid") {
      // Shift is a freeform behavior only — grid spans never aspect-lock.
      return { kind: "grid", geometry: gridResizeGeometryAt(session, pointerX, pointerY) };
    }
    return {
      kind: "freeform",
      rect: canvasResizeRectAt(session, pointerX, pointerY, shiftKey),
    };
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const active = resizeRef.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    applyGeometry(
      previewGeometryAt(active.session, event.clientX, event.clientY, event.shiftKey),
    );
  }

  function handleResizePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const active = resizeRef.current;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const finalGeometry = previewGeometryAt(
      active.session,
      event.clientX,
      event.clientY,
      event.shiftKey,
    );
    const startGeometry = startGeometryOf(active.session);
    endResize();
    if (isCanvasResizeNoop(startGeometry, finalGeometry)) {
      // No effective change: no commit, no history entry, no sync — and the
      // preview goes back to the authoritative geometry.
      applyGeometry(startGeometry);
      return;
    }
    // The preview STAYS at the final geometry: the shell hands it off to the
    // durable snapshot, or drops it (failed stage) — it never flashes back
    // to the old geometry in between.
    onResizeCommit(entity.id, finalGeometry);
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
    gesturesReady &&
    (resizeActiveId === null || resizeActiveId === entity.id);

  const commonStyle: CSSProperties = {
    ...itemStyle(geometry, item),
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

/** The committed start geometry of a session, in commit form. */
function startGeometryOf(session: CanvasResizeSession): ResizeCommitGeometry {
  return session.kind === "grid"
    ? { kind: "grid", geometry: session.startGeometry }
    : { kind: "freeform", rect: session.startRect };
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
