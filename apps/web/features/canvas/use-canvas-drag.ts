"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/react";
import type { CanvasLayout } from "@veladesk/canvas-engine";
import type { GridDefinition, LayoutItemId } from "@veladesk/desktop-engine";

import { areCanvasPixelMetricsEqual } from "./canvas-metrics";
import type { CanvasPixelMetrics } from "./canvas-metrics";
import { commitCanvasDrag, previewCanvasDrag } from "./canvas-drag";

/** Custom property the item body moves with during a drag preview. */
export const CANVAS_DRAG_PREVIEW_VAR = "--vd-canvas-drag-preview";

interface ActiveCanvasDragSession {
  readonly sourceItemId: LayoutItemId;
  readonly itemIds: readonly LayoutItemId[];
  readonly canvasAtStart: CanvasLayout;
  readonly metricsAtStart: CanvasPixelMetrics;
  readonly grid: GridDefinition;
}

export interface CanvasDragOptions {
  /**
   * The canvas being dragged. `null` disables sessions; identity is the
   * staleness signal, so a canvas replaced mid-drag invalidates the session.
   */
  readonly canvas: CanvasLayout | null;
  /** Snap lattice source (the page grid, kept after materialization). */
  readonly grid: GridDefinition;
  /** Current canvas pixel metrics, or `null` while unmeasurable. */
  readonly metrics: CanvasPixelMetrics | null;
  /**
   * Called exactly once per effective drop with the moved canvas and the
   * exact drag-start canvas it was computed from. Never called for cancels,
   * invalidations or no-op drops.
   */
  readonly onCommit: (movedCanvas: CanvasLayout, canvasAtStart: CanvasLayout) => void;
  /** The item ids this drag moves (selection-aware). Defaults to the source. */
  readonly getDragItemIds?: (sourceId: LayoutItemId) => readonly LayoutItemId[];
  readonly resolveItemElement?: (itemId: LayoutItemId) => Element | null;
}

/**
 * The canvas drag session.
 *
 * dnd-kit owns the pointer-follow transform of the dragged source; this hook
 * owns everything else: it snapshots canvas, metrics and the moving ids at
 * drag start, previews the resolved translation during the move (freeform:
 * continuous; snap: one snapped delta for the whole group, applied to the
 * source as a correction so the source and its peers stay rigid), and
 * commits each drag exactly once at drop time.
 *
 * Pointermove NEVER stages or persists anything — the preview is a CSS
 * custom property write, and the single durable commit happens on pointerup.
 */
export function useCanvasDrag({
  canvas,
  grid,
  metrics,
  onCommit,
  getDragItemIds,
  resolveItemElement,
}: CanvasDragOptions): {
  dragging: boolean;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragMove: (event: DragMoveEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
} {
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<ActiveCanvasDragSession | null>(null);
  const pendingPeerClearRef = useRef<ActiveCanvasDragSession | null>(null);
  const canvasRef = useRef<CanvasLayout | null>(canvas);
  const metricsRef = useRef<CanvasPixelMetrics | null>(metrics);
  const onCommitRef = useRef(onCommit);
  const getDragItemIdsRef = useRef(getDragItemIds);
  const resolveItemElementRef = useRef(resolveItemElement);

  useEffect(() => {
    canvasRef.current = canvas;
  }, [canvas]);
  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });
  useEffect(() => {
    getDragItemIdsRef.current = getDragItemIds;
  });
  useEffect(() => {
    resolveItemElementRef.current = resolveItemElement;
  });

  // Zero-bounce handoff: the drop render (with the consumer's optimistic
  // canvas) commits first, then the transient preview is dropped — both land
  // in the same paint, so the tiles never flash back to the old geometry.
  useLayoutEffect(() => {
    if (dragging) {
      return;
    }
    const session = pendingPeerClearRef.current;
    if (session !== null) {
      pendingPeerClearRef.current = null;
      clearPreview(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearPreview only reads refs and the DOM
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

  const handleDragStart = (event: DragStartEvent) => {
    const currentCanvas = canvasRef.current;
    const currentMetrics = metricsRef.current;
    if (currentCanvas === null || currentMetrics === null) {
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
      !requested.every((id) => currentCanvas.items.some((item) => item.id === id))
    ) {
      // Malformed group request: no session rather than a partial commit.
      return;
    }

    sessionRef.current = {
      sourceItemId: sourceId,
      itemIds: requested,
      canvasAtStart: currentCanvas,
      metricsAtStart: currentMetrics,
      grid,
    };
    setDragging(true);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const session = sessionRef.current;
    if (session === null) {
      return;
    }
    const deltaX = event.operation.position.current.x - event.operation.position.initial.x;
    const deltaY = event.operation.position.current.y - event.operation.position.initial.y;
    const preview = previewCanvasDrag({
      canvas: session.canvasAtStart,
      itemIds: session.itemIds,
      deltaX,
      deltaY,
      metrics: session.metricsAtStart,
      grid: session.grid,
    });

    for (const id of session.itemIds) {
      if (id === session.sourceItemId) {
        // dnd-kit already moved the source by the RAW pointer delta; the
        // correction carries it onto the snapped/rounded target so a snap
        // group never looks torn between its source and its peers.
        writePreview(
          id,
          `translate3d(${preview.appliedX - deltaX}px, ${preview.appliedY - deltaY}px, 0)`,
        );
        continue;
      }
      writePreview(id, `translate3d(${preview.appliedX}px, ${preview.appliedY}px, 0)`);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const session = sessionRef.current;
    sessionRef.current = null;

    if (event.canceled || session === null) {
      setDragging(false);
      if (session !== null) {
        clearPreview(session);
      }
      return;
    }

    // The canvas box changed size mid-drag: the pixel space the user aimed
    // at no longer exists, so the commit is invalidated.
    const currentMetrics = metricsRef.current;
    if (
      currentMetrics === null ||
      !areCanvasPixelMetricsEqual(currentMetrics, session.metricsAtStart)
    ) {
      setDragging(false);
      clearPreview(session);
      return;
    }

    // The canvas this drag started from is no longer current: stale session.
    if (canvasRef.current !== session.canvasAtStart) {
      setDragging(false);
      clearPreview(session);
      return;
    }

    const deltaX = event.operation.position.current.x - event.operation.position.initial.x;
    const deltaY = event.operation.position.current.y - event.operation.position.initial.y;
    const moved = commitCanvasDrag({
      canvas: session.canvasAtStart,
      itemIds: session.itemIds,
      deltaX,
      deltaY,
      metrics: session.metricsAtStart,
      grid: session.grid,
    });

    setDragging(false);
    if (moved === null) {
      // Effective no-op drop (dragged back onto its own rect): no handoff,
      // no stage, no history entry, no sync.
      clearPreview(session);
      return;
    }
    onCommitRef.current(moved, session.canvasAtStart);
    pendingPeerClearRef.current = session;
  };

  return { dragging, handleDragStart, handleDragMove, handleDragEnd };
}
