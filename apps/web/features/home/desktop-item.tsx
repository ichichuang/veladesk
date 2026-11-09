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
  GridCanvasItem,
} from "@veladesk/canvas-engine";

import { contextMenuAnchorFromElement, isContextMenuKeyEvent } from "./context-menu";
import { useVdHoverLift } from "@components/vd/hover-lift";
import { elementBoxChanged } from "./element-box";
import { AppIconSurface, AppIconGlyph } from "./app-icon-renderer";
import {
  appContentIconKind,
  buildAppContentStyleVars,
  resolveAppContentLayout,
} from "./app-content-layout";
import {
  appLabelPresentation,
  appVisual,
  buildAppIconStyleVars,
} from "./app-icon";
import { canvasRectStyle } from "../canvas/canvas-style";
import { gridPlacementStyle } from "../canvas/square-grid-metrics";
import { GridFlipSlot } from "../canvas/grid-flip-slot";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import { useItemResize, ITEM_RESIZE_HANDLES } from "./use-item-resize";
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
  /**
   * The appearance inspector is editing THIS app (019-C): a quiet accent
   * affordance only — never geometry handles, never drag changes.
   */
  readonly editingAppearance?: boolean;
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
  readonly onResizeCommit: (entityId: EntityId, geometry: import("../canvas/canvas-resize").ResizeCommitGeometry) => void;
  /** Reports a session start/end so the shell can lock competing gestures. */
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  /**
   * Grid-only target-slot feedback (task 017-B): the live integer preview
   * geometry while a resize gesture moves across cells (deduped by
   * equality — never once per pointer frame), and `null` when the gesture
   * ends, commits or cancels.
   */
  readonly onResizePreview?: ((geometry: import("../canvas/canvas-resize").GridItemGeometry | null) => void) | undefined;
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
 * the body; apps compose adaptively (019-B): the decoration surface fills
 * the whole box and icon + title flow inside it from the pure content
 * layout resolver, measured off the RENDERED box — never off persisted
 * pixel sizes. Folders keep their legacy centered-glyph composition.
 *
 * Apps are buttons: native focus and Enter/Space keep launch accessible in
 * view mode, while dnd-kit's keyboard sensor owns drag gestures in arrange
 * mode. View-mode clicks launch apps / open folders; arrange-mode clicks
 * drive the session selection. The RESIZE gesture session lives in
 * use-item-resize.ts (P1 split); this component only renders its handles.
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

function DesktopEntity({
  item,
  entity,
  arrange,
  dragEnabled,
  metrics,
  gridPitchPx,
  gridColumns,
  geometry,
  editingAppearance,
  selected,
  resizable,
  resizeActiveId,
  onResizeCommit,
  onResizeSessionChange,
  onResizePreview,
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
  // Decorative View-mode hover lift (task 022): GSAP owns the tween on the
  // INNER .vela-item__body node; the dnd-kit transform on the item root is
  // untouched. Arrange mode never lifts (hover must not fight a gesture).
  const {
    innerRef: liftInnerRef,
    onPointerEnter: liftEnter,
    onPointerLeave: liftLeave,
    onPointerCancel: liftCancel,
    onPointerDown: liftDown,
    onPointerUp: liftUp,
  } = useVdHoverLift<HTMLButtonElement>(-2);
  const handleLiftEnter = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!arrange && event.currentTarget.dataset.dragging !== "true") {
        liftEnter(event);
      }
    },
    [arrange, liftEnter],
  );
  // The snap-mode FLIP slot (P1): in Grid geometry the SLOT owns the cell
  // placement (and receives the live resize preview); the button fills it.
  const slotRef = useRef<HTMLDivElement | null>(null);
  // The RENDERED item box (019-B): the single sizing authority for the
  // adaptive app content. Grid gaps, span changes, freeform rects and
  // window resizes all funnel through one measurement. Deduped to 0.5px so
  // writing the presentation vars never re-triggers the observer (content
  // is absolutely positioned — it cannot resize the box back).
  const box = useElementBox(itemRef);

  const resize = useItemResize({
    item,
    entityId: entity.id,
    geometry,
    gesturesReady,
    metrics,
    gridPitchPx,
    gridColumns,
    itemRef,
    slotRef,
    onResizeCommit,
    onResizeSessionChange,
    onResizePreview,
  });

  const showResizeHandles =
    entity.kind === "app" &&
    resizable &&
    !isDragging &&
    gesturesReady &&
    (resizeActiveId === null || resizeActiveId === entity.id);

  // Grid geometry renders inside the FLIP slot (P1): the SLOT carries the
  // cell placement and the drag lift; the button fills it and keeps only
  // its presentation vars. Freeform keeps the direct rect style.
  const inGridSlot = geometry === "grid";
  const commonStyle: CSSProperties = inGridSlot
    ? {}
    : {
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
        {ITEM_RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            className="vela-item__resize-handle"
            data-handle={handle}
            role="button"
            tabIndex={-1}
            aria-label={t("arrange.resizeIcon")}
            onPointerDownCapture={resize.handleResizePointerDown(handle)}
            onPointerMove={resize.handleResizePointerMove}
            onPointerUp={resize.handleResizePointerUp}
            onPointerCancel={resize.handleLostPointerCapture}
            onLostPointerCapture={resize.handleLostPointerCapture}
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
    // Adaptive content composition (019-B): the user owns only the outer
    // geometry; the resolver decides icon/title layout from the RENDERED
    // box. Presentation vars ride on the ITEM button next to the geometry
    // styles — disjoint key sets (--vd-app-* vs gridColumn/gridRow/left/…),
    // so the merge is conflict-free and sizing can never leak into tracks.
    const presentation = appVisual(entity);
    const label = appLabelPresentation(presentation);
    const contentLayout =
      box === null
        ? undefined
        : resolveAppContentLayout({
            width: box.width,
            height: box.height,
            labelVisible: label.visible,
            iconKind: appContentIconKind(entity),
            ...(entity.icon.kind === "generated"
              ? // Icon text always renders ONE character (IconText).
                { generatedTextLength: 1 }
              : {}),
          });
    const appButton = (
      <button
        type="button"
        ref={mergeRefs(ref, itemRef)}
        data-item-id={item.id}
        className="vela-item"
        data-kind="app"
        data-appearance-app-id={entity.id}
        {...draggingProps}
        {...selectionProps}
        data-inspector-editing={editingAppearance === true ? "true" : undefined}
        style={
          {
            ...buildAppIconStyleVars(presentation),
            ...(contentLayout === undefined ? undefined : buildAppContentStyleVars(contentLayout)),
            ...commonStyle,
          } as CSSProperties
        }
        // The accessible name never depends on the visible label: hiding
        // the label (labelVisible=false) must keep the button announced.
        aria-label={entity.name}
        title={entity.name}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onPointerDown={event => { if (!arrange) liftDown(event); }}
        onPointerUp={event => { if (!arrange) liftUp(event); }}
        onPointerEnter={handleLiftEnter}
        onPointerLeave={liftLeave}
        onPointerCancel={liftCancel}
      >
        <span className="vela-item__body" ref={liftInnerRef}>
          <AppIconSurface app={entity} />
          <span className="vela-app-content" data-layout={contentLayout?.mode ?? "stack"}>
            <span className="vela-app-content__icon">
              <AppIconGlyph app={entity} />
            </span>
            {label.visible ? <span className="vela-item__label">{entity.name}</span> : null}
          </span>
        </span>
        {resizeHandles}
      </button>
    );
    if (inGridSlot) {
      return (
        <GridFlipSlot
          item={item as GridCanvasItem}
          flip
          dragging={isDragging}
          slotRef={slotRef}
        >
          {appButton}
        </GridFlipSlot>
      );
    }
    return appButton;
  }

  if (entity.kind === "folder") {
    const folderButton = (
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
    if (inGridSlot) {
      return (
        <GridFlipSlot
          item={item as GridCanvasItem}
          flip
          dragging={isDragging}
          slotRef={slotRef}
        >
          {folderButton}
        </GridFlipSlot>
      );
    }
    return folderButton;
  }

  const widgetNode = (
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
  if (inGridSlot) {
    return (
      <GridFlipSlot
        item={item as GridCanvasItem}
        flip
        dragging={isDragging}
        slotRef={slotRef}
      >
        {widgetNode}
      </GridFlipSlot>
    );
  }
  return widgetNode;
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

/**
 * Observes the element behind `ref` and reports its rendered box, deduped
 * to half a pixel via {@link elementBoxChanged} (019-B): the single sizing
 * authority for the adaptive app content. `null` until the first
 * observation — CSS carries mid-size fallbacks for that first frame. The
 * content it feeds is absolutely positioned, so writing the derived vars
 * can never resize the box back.
 */
function useElementBox(
  ref: RefObject<HTMLElement | null>
): { width: number; height: number } | null {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect === undefined || rect.width <= 0 || rect.height <= 0) {
        return;
      }
      setBox((current) =>
        elementBoxChanged(current, rect)
          ? { width: rect.width, height: rect.height }
          : current
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
    // The item element is stable for the component's lifetime; remounts
    // (drop handoff eviction, section switch) re-run this hook fresh.
  }, [ref]);
  return box;
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
