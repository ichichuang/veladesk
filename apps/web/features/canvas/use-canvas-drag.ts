"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/react";
import { areCanvasLayoutsEqual } from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";
import type { LayoutItemId } from "@veladesk/desktop-engine";

import type { CanvasPixelMetrics } from "./canvas-metrics";
import { commitCanvasDrag, previewCanvasDrag } from "./canvas-drag";
import type { GridItemGeometry } from "./canvas-resize";

/** Custom property the item body moves with during a drag preview. */
export const CANVAS_DRAG_PREVIEW_VAR = "--vd-canvas-drag-preview";

interface ActiveCanvasDragSession {
  readonly sourceItemId: LayoutItemId;
  readonly itemIds: readonly LayoutItemId[];
  readonly placementAtStart: PagePlacement;
  /** Freeform: the canvas pixel box at start. Grid: null. */
  readonly metricsAtStart: CanvasPixelMetrics | null;
  /** Grid: the cell pitch at start. Freeform: null. */
  readonly pitchAtStart: number | null;
}

export interface CanvasDragOptions {
  /**
   * The placement being dragged. `null` disables sessions; identity is the
   * staleness signal, so a placement replaced mid-drag invalidates the
   * session.
   */
  readonly placement: PagePlacement | null;
  /** Current canvas pixel metrics, or `null` while unmeasurable. */
  readonly metrics: CanvasPixelMetrics | null;
  /** Grid cell pitch (cellPx + gapPx), or `null` for freeform sections. */
  readonly pitchPx: number | null;
  /**
   * Called exactly once per effective drop with the moved placement and the
   * exact drag-start placement it was computed from. Never called for
   * cancels, invalidations or no-op drops.
   */
  readonly onCommit: (movedPlacement: PagePlacement, placementAtStart: PagePlacement) => void;
  /** The item ids this drag moves (selection-aware). Defaults to the source. */
  readonly getDragItemIds?: (sourceId: LayoutItemId) => readonly LayoutItemId[];
  readonly resolveItemElement?: (itemId: LayoutItemId) => Element | null;
  /**
   * Grid-only target-slot feedback (task 017-B): reports the resolved
   * target boxes while the drag moves across cells (deduped — a report per
   * integer delta CHANGE, never per pointer frame) and `null` when the
   * gesture clears, cancels, invalidates, no-ops or commits.
   */
  readonly onGridTargetChange?:
    | ((boxes: readonly GridItemGeometry[] | null) => void)
    | undefined;
}

/**
 * The canvas drag session.
 *
 * dnd-kit owns the pointer-follow transform of the dragged source; this hook
 * owns everything else: it snapshots the placement, metrics/pitch and the
 * moving ids at drag start, previews the resolved translation during the
 * move — driven by NATIVE pointermove positions, because the 0.5
 * DragMoveEvent payload lags the real pointer by one event (freeform: the
 * lag is sub-pixel noise; grid: it visibly misses the snapped cell) —
 * writes grid: whole cells / freeform: continuous, one rigid delta for the
 * whole group, applied to the source as a correction so the source and its
 * peers stay aligned, and commits each drag exactly once at drop time.
 *
 * Pointermove NEVER stages or persists anything — the preview is a CSS
 * custom property write, and the single durable commit happens on pointerup.
 */
export function useCanvasDrag({
  placement,
  metrics,
  pitchPx,
  onCommit,
  getDragItemIds,
  resolveItemElement,
  onGridTargetChange,
}: CanvasDragOptions): {
  dragging: boolean;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragMove: (event: DragMoveEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
} {
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<ActiveCanvasDragSession | null>(null);
  const pendingPeerClearRef = useRef<ActiveCanvasDragSession | null>(null);
  const placementRef = useRef<PagePlacement | null>(placement);
  const metricsRef = useRef<CanvasPixelMetrics | null>(metrics);
  const pitchRef = useRef<number | null>(pitchPx);
  const onCommitRef = useRef(onCommit);
  const getDragItemIdsRef = useRef(getDragItemIds);
  const resolveItemElementRef = useRef(resolveItemElement);
  const onGridTargetChangeRef = useRef(onGridTargetChange);
  const lastTargetKeyRef = useRef<string | null>(null);
  /** dnd-kit's delta origin, captured from the first DragMoveEvent. */
  const dragInitialRef = useRef<{ x: number; y: number } | null>(null);
  /** Latest native pointermove position while a session is live. */
  const livePointerRef = useRef<{ x: number; y: number } | null>(null);
  /** Whether this session ever saw a native pointer move. */
  const sawNativePointerRef = useRef(false);
  const nativeMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);

  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);
  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);
  useEffect(() => {
    pitchRef.current = pitchPx;
  }, [pitchPx]);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });
  useEffect(() => {
    getDragItemIdsRef.current = getDragItemIds;
  });
  useEffect(() => {
    resolveItemElementRef.current = resolveItemElement;
  });
  useEffect(() => {
    onGridTargetChangeRef.current = onGridTargetChange;
  });

  // Zero-bounce handoff: the drop render (with the consumer's optimistic
  // placement) commits first, then the transient preview is dropped — both
  // land in the same paint, so the tiles never flash back to the old
  // geometry.
  useLayoutEffect(() => {
    if (dragging) {
      return;
    }
    const session = pendingPeerClearRef.current;
    if (session !== null) {
      pendingPeerClearRef.current = null;
      clearPreview(session);
      reportTargets(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearPreview only reads refs and the DOM
  }, [dragging]);

  // Safety net: a session that never reaches handleDragEnd (unmount mid-
  // drag) must not leak the native pointermove listener.
  useEffect(() => {
    if (!dragging) {
      detachNativePointerTracking();
      dragInitialRef.current = null;
      sawNativePointerRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- teardown only touches refs
  }, [dragging]);

  function writePreview(itemId: LayoutItemId, value: string | null): void {
    const element = resolveItemElementRef.current?.(itemId);
    if (element === null || element === undefined) {
      return;
    }
    const target = element as HTMLElement;
    if (value === null) {
      target.style.removeProperty(CANVAS_DRAG_PREVIEW_VAR);
    } else {
      target.style.setProperty(CANVAS_DRAG_PREVIEW_VAR, value);
    }
  }

  function clearPreview(session: ActiveCanvasDragSession): void {
    for (const id of session.itemIds) {
      writePreview(id, null);
    }
  }

  /**
   * Target-slot feedback: the resolved boxes of the moving items at the
   * current integer delta. Reported only when the delta actually crossed a
   * cell boundary — a setState per crossing, never per pointer frame.
   */
  function reportGridTargets(
    session: ActiveCanvasDragSession,
    columnDelta: number,
    rowDelta: number,
  ): void {
    const callback = onGridTargetChangeRef.current;
    if (callback === undefined || session.placementAtStart.mode !== "grid") {
      return;
    }
    const boxes = session.placementAtStart.items
      .filter((item) => session.itemIds.includes(item.id))
      .map((item) => ({
        column: item.column + columnDelta,
        row: item.row + rowDelta,
        columnSpan: item.columnSpan,
        rowSpan: item.rowSpan,
      }));
    const key = JSON.stringify(boxes);
    if (key === lastTargetKeyRef.current) {
      return;
    }
    lastTargetKeyRef.current = key;
    callback(boxes);
  }

  /** Clears the target-slot feedback (idempotent). */
  function reportTargets(value: null): void {
    lastTargetKeyRef.current = null;
    onGridTargetChangeRef.current?.(value);
  }

  const handleDragStart = (event: DragStartEvent) => {
    const currentPlacement = placementRef.current;
    if (currentPlacement === null) {
      return;
    }
    const isGrid = currentPlacement.mode === "grid";
    const currentMetrics = isGrid ? null : metricsRef.current;
    const currentPitch = isGrid ? pitchRef.current : null;
    if ((!isGrid && currentMetrics === null) || (isGrid && currentPitch === null)) {
      return;
    }
    const rawSourceId = event.operation.source?.id;
    if (rawSourceId === undefined) {
      return;
    }
    const sourceId = String(rawSourceId) as LayoutItemId;
    const requested =
      getDragItemIdsRef.current !== undefined
        ? getDragItemIdsRef.current(sourceId)
        : [sourceId];
    if (
      new Set(requested).size !== requested.length ||
      !requested.includes(sourceId) ||
      !requested.every((id) => currentPlacement.items.some((item) => item.id === id))
    ) {
      // Malformed group request: no session rather than a partial commit.
      return;
    }

    sessionRef.current = {
      sourceItemId: sourceId,
      itemIds: requested,
      placementAtStart: currentPlacement,
      metricsAtStart: currentMetrics,
      pitchAtStart: currentPitch,
    };
    dragInitialRef.current = null;
    sawNativePointerRef.current = false;
    attachNativePointerTracking();
    setDragging(true);
  };

  /**
   * Writes the resolved preview (source correction + peer transforms +
   * target feedback) for one raw pointer delta.
   */
  function runPreview(session: ActiveCanvasDragSession, deltaX: number, deltaY: number): void {
    const preview = previewCanvasDrag({
      placement: session.placementAtStart,
      itemIds: session.itemIds,
      deltaX,
      deltaY,
      metrics: session.metricsAtStart ?? { width: 1, height: 1 },
      pitchPx: session.pitchAtStart ?? 1,
    });

    for (const id of session.itemIds) {
      if (id === session.sourceItemId) {
        // dnd-kit already moved the source by the RAW pointer delta; the
        // correction carries it onto the cell/rounded target so a grid
        // group never looks torn between its source and its peers.
        writePreview(
          id,
          `translate3d(${preview.appliedX - deltaX}px, ${preview.appliedY - deltaY}px, 0)`,
        );
        continue;
      }
      writePreview(id, `translate3d(${preview.appliedX}px, ${preview.appliedY}px, 0)`);
    }
    reportGridTargets(session, preview.columnDelta, preview.rowDelta);
  }

  /**
   * The drag preview is driven by NATIVE pointermove positions, not by
   * DragMoveEvent.operation.position: in @dnd-kit/react 0.5 the event's
   * `current` lags the real pointer by one event (observed mid-gesture in
   * the browser), so a correction computed from it visibly misses the
   * snapped cell until the pointer stops. Native moves are exact; the
   * event's `initial` is still the authoritative delta origin, captured
   * once on the first move event (native moves that arrive earlier are
   * replayed against it).
   */
  function attachNativePointerTracking(): void {
    const handler = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (session === null) {
        return;
      }
      sawNativePointerRef.current = true;
      livePointerRef.current = { x: event.clientX, y: event.clientY };
      const initial = dragInitialRef.current;
      if (initial === null) {
        return;
      }
      runPreview(session, event.clientX - initial.x, event.clientY - initial.y);
    };
    nativeMoveHandlerRef.current = handler;
    window.addEventListener("pointermove", handler, { capture: true });
  }

  function detachNativePointerTracking(): void {
    if (nativeMoveHandlerRef.current !== null) {
      window.removeEventListener("pointermove", nativeMoveHandlerRef.current, { capture: true });
      nativeMoveHandlerRef.current = null;
    }
    livePointerRef.current = null;
  }

  const handleDragMove = (event: DragMoveEvent) => {
    const session = sessionRef.current;
    if (session === null) {
      return;
    }
    if (dragInitialRef.current === null) {
      dragInitialRef.current = {
        x: event.operation.position.initial.x,
        y: event.operation.position.initial.y,
      };
      const live = livePointerRef.current;
      if (live !== null) {
        runPreview(
          session,
          live.x - dragInitialRef.current.x,
          live.y - dragInitialRef.current.y,
        );
      }
      return;
    }
    // Pointer drags are previewed from native moves (see above). The event
    // path remains for sensor sessions that never produce native moves —
    // e.g. dnd-kit's keyboard sensor with synthetic positions.
    if (!sawNativePointerRef.current) {
      const deltaX = event.operation.position.current.x - dragInitialRef.current.x;
      const deltaY = event.operation.position.current.y - dragInitialRef.current.y;
      runPreview(session, deltaX, deltaY);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    detachNativePointerTracking();
    dragInitialRef.current = null;
    sawNativePointerRef.current = false;

    if (event.canceled || session === null) {
      setDragging(false);
      if (session !== null) {
        clearPreview(session);
        reportTargets(null);
      }
      return;
    }

    // The pixel space the user aimed at changed mid-drag (width resize in
    // freeform, pitch change in grid): the commit is invalidated.
    const isGrid = session.placementAtStart.mode === "grid";
    if (isGrid) {
      if (pitchRef.current === null || pitchRef.current !== session.pitchAtStart) {
        setDragging(false);
        clearPreview(session);
        reportTargets(null);
        return;
      }
    } else if (
      metricsRef.current === null ||
      session.metricsAtStart === null ||
      metricsRef.current.width !== session.metricsAtStart.width ||
      metricsRef.current.height !== session.metricsAtStart.height
    ) {
      setDragging(false);
      clearPreview(session);
      reportTargets(null);
      return;
    }

    // The placement this drag started from is no longer current: stale
    // session. The comparison is STRUCTURAL on purpose — a legacy page
    // derives its placement per render, so identity would drop every commit
    // on a page that has not been materialized yet.
    const currentPlacement = placementRef.current;
    if (
      currentPlacement === null ||
      !areCanvasLayoutsEqual(currentPlacement, session.placementAtStart)
    ) {
      setDragging(false);
      clearPreview(session);
      reportTargets(null);
      return;
    }

    const deltaX = event.operation.position.current.x - event.operation.position.initial.x;
    const deltaY = event.operation.position.current.y - event.operation.position.initial.y;
    const moved = commitCanvasDrag({
      placement: session.placementAtStart,
      itemIds: session.itemIds,
      deltaX,
      deltaY,
      metrics: session.metricsAtStart ?? { width: 1, height: 1 },
      pitchPx: session.pitchAtStart ?? 1,
    });

    setDragging(false);
    if (moved === null) {
      // Effective no-op drop (dragged back onto its own spot): no handoff,
      // no stage, no history entry, no sync.
      clearPreview(session);
      reportTargets(null);
      return;
    }
    onCommitRef.current(moved, session.placementAtStart);
    pendingPeerClearRef.current = session;
    reportTargets(null);
  };

  return { dragging, handleDragStart, handleDragMove, handleDragEnd };
}
