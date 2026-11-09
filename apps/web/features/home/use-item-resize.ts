"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { EntityId } from "@veladesk/domain";
import type {
  CanvasLayoutItem,
  CanvasResizeHandle,
  GridCanvasItem,
} from "@veladesk/canvas-engine";

import {
  CANVAS_RESIZE_HANDLES,
  areGridGeometriesEqual,
  canvasResizeRectAt,
  gridResizeGeometryAt,
  isCanvasResizeNoop,
} from "../canvas/canvas-resize";
import type {
  CanvasResizeSession,
  GridItemGeometry,
  ResizeCommitGeometry,
} from "../canvas/canvas-resize";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import { canvasRectStyle } from "../canvas/canvas-style";
import { gridPlacementStyle } from "../canvas/square-grid-metrics";
import type { ItemGeometry } from "./desktop-item";

/** A live resize gesture, keyed by the pointer that owns it. */
interface ActiveResize {
  readonly session: CanvasResizeSession;
  readonly pointerId: number;
}

/** The committed start geometry of a session, in commit form. */
function startGeometryOf(session: CanvasResizeSession): ResizeCommitGeometry {
  return session.kind === "grid"
    ? { kind: "grid", geometry: session.startGeometry }
    : { kind: "freeform", rect: session.startRect };
}

export interface UseItemResizeInput {
  /** The placed item (grid item or canvas rect) being resized. */
  readonly item: CanvasLayoutItem | GridCanvasItem;
  /** The entity the gesture commits for. */
  readonly entityId: EntityId;
  /** Which geometry model places this item. */
  readonly geometry: ItemGeometry;
  /** Whether the metrics the gesture needs are live. */
  readonly gesturesReady: boolean;
  /** Freeform: canvas pixel metrics. Grid: null. */
  readonly metrics: CanvasPixelMetrics | null;
  /** Grid: cell pitch. Freeform: null. */
  readonly gridPitchPx: number | null;
  /** Grid: the persistent column count (resize bounds). */
  readonly gridColumns: number | null;
  /** The item element (the button) — freeform geometry writes here. */
  readonly itemRef: RefObject<HTMLElement | null>;
  /** The FLIP slot element — grid geometry writes there when present. */
  readonly slotRef: RefObject<HTMLDivElement | null>;
  /** Fires exactly once per committed, non-noop resize. */
  readonly onResizeCommit: (entityId: EntityId, geometry: ResizeCommitGeometry) => void;
  /** Reports a session start/end so the shell can lock competing gestures. */
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  /**
   * Grid-only target-slot feedback: the live integer preview geometry
   * while the gesture moves across cells (deduped by equality — never once
   * per pointer frame), and `null` when the gesture ends, commits or
   * cancels.
   */
  readonly onResizePreview: ((geometry: GridItemGeometry | null) => void) | undefined;
}

/**
 * One item's RESIZE SESSION (extracted from desktop-item.tsx, P1
 * hygiene): the pointer-captured gesture over the eight handles, the
 * no-render preview (inline geometry writes), the deduped grid feedback
 * reports, Escape-cancel, and the single commit at release. The component
 * keeps only the rendering; this hook owns every pointer-level concern.
 *
 * The preview writes styles DIRECTLY on the element — never through React
 * state — so a pointermove costs no render. Cancel and no-op commits put
 * the authoritative start geometry back, because React will not re-apply
 * a style prop that never changed.
 */
export function useItemResize(input: UseItemResizeInput) {
  const {
    item,
    entityId,
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
  } = input;

  const resizeRef = useRef<ActiveResize | null>(null);
  const [resizing, setResizing] = useState(false);
  const onResizePreviewRef = useRef(onResizePreview);
  const reportedPreviewRef = useRef<GridItemGeometry | null>(null);
  useEffect(() => {
    onResizePreviewRef.current = onResizePreview;
  });

  /**
   * The geometry the element shows right now, as inline styles. Grid
   * geometry lives on the FLIP slot (the slot is the CSS-Grid child; the
   * button fills it) — falls back to the item for the rare non-slot grid
   * render (missing-entity placeholder).
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
      const target = slotRef.current ?? element;
      const style = gridPlacementStyle({ id: item.id, ...next.geometry }) as Record<
        string,
        string | number
      >;
      target.style.left = "";
      target.style.top = "";
      target.style.width = "";
      target.style.height = "";
      target.style.gridColumn = String(style.gridColumn);
      target.style.gridRow = String(style.gridRow);
    },
    [item.id, itemRef, slotRef],
  );

  function endResize() {
    resizeRef.current = null;
    setResizing(false);
    reportResizePreview(null);
    onResizeSessionChange(entityId, false);
  }

  /**
   * Target-slot feedback: the live integer preview, deduped by structural
   * equality so a report only fires when the resolved geometry actually
   * changed — never once per pointermove.
   */
  function reportResizePreview(geometry: GridItemGeometry | null): void {
    const last = reportedPreviewRef.current;
    if (geometry === null) {
      if (last === null) {
        return;
      }
    } else if (last !== null && areGridGeometriesEqual(last, geometry)) {
      return;
    }
    reportedPreviewRef.current = geometry;
    onResizePreviewRef.current?.(geometry);
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
            metrics: metrics as NonNullable<CanvasPixelMetrics>,
          },
          pointerId: event.pointerId,
        };
      }
      setResizing(true);
      onResizeSessionChange(entityId, true);
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
    const next = previewGeometryAt(active.session, event.clientX, event.clientY, event.shiftKey);
    applyGeometry(next);
    if (next.kind === "grid") {
      reportResizePreview(next.geometry);
    }
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
    onResizeCommit(entityId, finalGeometry);
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

  // A remount mid-gesture (drop handoff eviction, section switch) must not
  // leave a dangling feedback box in the shell.
  useEffect(() => {
    return () => {
      onResizePreviewRef.current?.(null);
    };
  }, []);

  return {
    resizing,
    applyGeometry,
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerUp,
    handleLostPointerCapture,
  };
}

/** The eight handles the item renders (kept beside the gesture model). */
export const ITEM_RESIZE_HANDLES = CANVAS_RESIZE_HANDLES;
