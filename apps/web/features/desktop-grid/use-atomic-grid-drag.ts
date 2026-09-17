"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { moveItem } from "@veladesk/desktop-engine";
import type { GridPosition, PageLayout } from "@veladesk/desktop-engine";
import {
  dragDeltaToDesiredPosition,
  type GridPixelMetrics,
} from "@veladesk/desktop-interaction";

import { areGridPixelMetricsEqual } from "./grid-metrics";

/**
 * One drag interaction, snapshotted at drag start.
 *
 * References only — the engine keeps layouts immutable and pixel metrics are
 * replaced (never mutated) on re-measure, so the captured references stay a
 * faithful picture of the moment the drag began. The drop is computed against
 * exactly this snapshot, never against a later render.
 */
interface ActiveDragSession {
  readonly itemId: string;
  readonly startPosition: GridPosition;
  readonly layoutAtStart: PageLayout;
  readonly metricsAtStart: GridPixelMetrics;
}

export interface AtomicGridDragOptions {
  /**
   * The grid layout being dragged. Passing `null` disables sessions (no
   * active page). Identity is the staleness signal: a layout replaced
   * mid-drag invalidates the in-flight session.
   */
  readonly layout: PageLayout | null;
  /** Current pixel metrics, or `null` while the grid is unmeasurable. */
  readonly metrics: GridPixelMetrics | null;
  /**
   * Called exactly once per valid drop with the moved layout and the exact
   * drag-start layout it was computed from. Not called for cancels, resize
   * invalidations, engine refusals or stale sessions.
   */
  readonly onCommit: (movedLayout: PageLayout, layoutAtStart: PageLayout) => void;
}

/**
 * The atomic drag-session contract shared by the production desktop and the
 * desktop interaction lab (validated in task 003-B).
 *
 * dnd-kit owns the pointer-follow transform while dragging. This hook owns
 * everything else: it snapshots layout and pixel metrics at drag start and
 * commits each drag exactly once at drop time — free-transform delta →
 * pixel→grid conversion → engine `moveItem` nearest-free — dropping the
 * commit when the drag was canceled, the grid resized mid-drag, or the
 * layout changed since drag start.
 */
export function useAtomicGridDrag({
  layout,
  metrics,
  onCommit,
}: AtomicGridDragOptions): {
  dragging: boolean;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
} {
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<ActiveDragSession | null>(null);
  const layoutRef = useRef<PageLayout | null>(layout);
  const metricsRef = useRef<GridPixelMetrics | null>(metrics);
  const onCommitRef = useRef(onCommit);

  // Event-handler-visible mirrors of the latest props. Assigning in an
  // effect (not render) keeps render pure; drag events always fire after
  // commit + effects, so the mirrors are current when they matter.
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  const handleDragStart = (event: DragStartEvent) => {
    // No measurement yet → no session; drags are also disabled at the source,
    // this guard keeps the session contract true regardless.
    const currentLayout = layoutRef.current;
    const currentMetrics = metricsRef.current;
    if (currentLayout === null || currentMetrics === null) {
      return;
    }
    const sourceId = event.operation.source?.id;
    const item =
      sourceId === undefined
        ? undefined
        : currentLayout.items.find((candidate) => candidate.id === sourceId);
    if (item === undefined) {
      return;
    }

    sessionRef.current = {
      itemId: item.id,
      startPosition: item.position,
      layoutAtStart: currentLayout,
      metricsAtStart: currentMetrics,
    };
    setDragging(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    // Session cleanup happens on every path — normal drop, cancel, resize
    // invalidation, stale layout, engine refusal — before any early return.
    const session = sessionRef.current;
    sessionRef.current = null;
    setDragging(false);

    if (event.canceled || session === null) {
      return;
    }

    // Grid geometry changed mid-drag: the pixel space the user aimed at no
    // longer exists, so the commit is invalidated.
    const currentMetrics = metricsRef.current;
    if (
      currentMetrics === null ||
      !areGridPixelMetricsEqual(currentMetrics, session.metricsAtStart)
    ) {
      return;
    }

    // The layout this drag started from is no longer the current one: the
    // session is stale and must not commit against a newer world.
    if (layoutRef.current !== session.layoutAtStart) {
      return;
    }

    const delta = {
      x: event.operation.position.current.x - event.operation.position.initial.x,
      y: event.operation.position.current.y - event.operation.position.initial.y,
    };
    const desired = dragDeltaToDesiredPosition({
      start: session.startPosition,
      delta,
      metrics: session.metricsAtStart,
    });

    // Collision, clamping and nearest-free resolution all live in the engine,
    // computed against the drag-start layout snapshot.
    const result = moveItem(session.layoutAtStart, session.itemId, desired, {
      placement: "nearest-free",
    });
    if (result.ok) {
      onCommitRef.current(result.layout, session.layoutAtStart);
    }
  };

  return { dragging, handleDragStart, handleDragEnd };
}
