"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/react";
import { moveItem, moveItems } from "@veladesk/desktop-engine";
import type { GridPosition, LayoutItemId, PageLayout } from "@veladesk/desktop-engine";
import {
  dragDeltaToDesiredPosition,
  type GridPixelMetrics,
} from "@veladesk/desktop-interaction";

import { translationFromDesired } from "./group-drag";
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
  readonly sourceItemId: LayoutItemId;
  readonly startPosition: GridPosition;
  readonly itemIds: readonly LayoutItemId[];
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
  /**
   * Rigid group support: the item ids this drag moves. Defaults to the
   * source alone. The returned ids must include the source, be unique and
   * all exist in the drag-start layout — otherwise no session starts.
   */
  readonly getDragItemIds?: (sourceId: LayoutItemId) => readonly LayoutItemId[];
  /**
   * Resolves a layout item's DOM element for the transient peer preview.
   * Only needed together with `getDragItemIds`; peers get the same pixel
   * translation as the dnd-kit-owned source during the drag.
   */
  readonly resolveItemElement?: (itemId: LayoutItemId) => Element | null;
}

/**
 * The atomic drag-session contract shared by the production desktop and the
 * desktop interaction lab (validated in task 003-B, group-aware since 012).
 *
 * dnd-kit owns the pointer-follow transform of the dragged source. This hook
 * owns everything else: it snapshots layout, metrics and the moving item ids
 * at drag start, translates peers with a transient CSS preview during the
 * move, and commits each drag exactly once at drop time — free-transform
 * delta → pixel→grid conversion → rigid engine `moveItems` — dropping the
 * commit when the drag was canceled, the grid resized mid-drag, or the
 * layout changed since drag start.
 */
export function useAtomicGridDrag({
  layout,
  metrics,
  onCommit,
  getDragItemIds,
  resolveItemElement,
}: AtomicGridDragOptions): {
  dragging: boolean;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragMove: (event: DragMoveEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
} {
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<ActiveDragSession | null>(null);
  /**
   * A valid drop whose peer preview must be cleared only after the commit
   * render. Clearing synchronously would paint one frame with the peers'
   * transforms gone and their grid cells still at the pre-drop positions —
   * a one-frame rebound — so the clear is deferred to a layout effect that
   * runs after the optimistic layout renders but before paint. Cancel,
   * invalidation and refusal paths still clear synchronously (returning to
   * the unchanged layout is the correct visual there).
   */
  const pendingPeerClearRef = useRef<ActiveDragSession | null>(null);
  const layoutRef = useRef<PageLayout | null>(layout);
  const metricsRef = useRef<GridPixelMetrics | null>(metrics);
  const onCommitRef = useRef(onCommit);
  const getDragItemIdsRef = useRef(getDragItemIds);
  const resolveItemElementRef = useRef(resolveItemElement);

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
  useEffect(() => {
    getDragItemIdsRef.current = getDragItemIds;
  });
  useEffect(() => {
    resolveItemElementRef.current = resolveItemElement;
  });

  // Zero-bounce peer handoff: the drop render (with the consumer's
  // optimistic display layout, if any) commits, THEN the transient peer
  // transforms are dropped — both land in the same paint, before the
  // browser gets a chance to show a half-teardown frame.
  useLayoutEffect(() => {
    if (dragging) {
      return;
    }
    const session = pendingPeerClearRef.current;
    if (session !== null) {
      pendingPeerClearRef.current = null;
      clearPeerPreview(session);
    }
  }, [dragging]);

  /** Transient peer preview: peers follow the source's pixel translation. */
  function applyPeerPreview(
    session: ActiveDragSession,
    deltaX: number,
    deltaY: number,
  ): void {
    const resolve = resolveItemElementRef.current;
    if (resolve === undefined) {
      return;
    }
    for (const id of session.itemIds) {
      if (id === session.sourceItemId) {
        // The source transform belongs to dnd-kit — never fight it.
        continue;
      }
      const element = resolve(id);
      if (element !== null) {
        (element as HTMLElement).style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      }
    }
  }

  /** Drops every peer transient transform (drop, cancel, invalidation). */
  function clearPeerPreview(session: ActiveDragSession): void {
    const resolve = resolveItemElementRef.current;
    if (resolve === undefined) {
      return;
    }
    for (const id of session.itemIds) {
      if (id === session.sourceItemId) {
        continue;
      }
      const element = resolve(id);
      if (element !== null) {
        (element as HTMLElement).style.transform = "";
      }
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    // No measurement yet → no session; drags are also disabled at the source,
    // this guard keeps the session contract true regardless.
    const currentLayout = layoutRef.current;
    const currentMetrics = metricsRef.current;
    if (currentLayout === null || currentMetrics === null) {
      return;
    }
    const rawSourceId = event.operation.source?.id;
    if (rawSourceId === undefined) {
      return;
    }
    // VelaDesk layout item ids are always strings.
    const sourceId = String(rawSourceId) as LayoutItemId;
    const itemIds =
      getDragItemIdsRef.current !== undefined
        ? getDragItemIdsRef.current(sourceId)
        : [sourceId];
    if (
      new Set(itemIds).size !== itemIds.length ||
      !itemIds.includes(sourceId) ||
      !itemIds.every((id) => currentLayout.items.some((entry) => entry.id === id))
    ) {
      // Malformed group request: no session rather than a partial commit.
      return;
    }
    const item = currentLayout.items.find((entry) => entry.id === sourceId);
    if (item === undefined) {
      return;
    }

    sessionRef.current = {
      sourceItemId: sourceId,
      startPosition: item.position,
      itemIds,
      layoutAtStart: currentLayout,
      metricsAtStart: currentMetrics,
    };
    setDragging(true);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const session = sessionRef.current;
    if (session === null) {
      return;
    }
    applyPeerPreview(
      session,
      event.operation.position.current.x - event.operation.position.initial.x,
      event.operation.position.current.y - event.operation.position.initial.y,
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    // Session cleanup happens on every path — normal drop, cancel, resize
    // invalidation, stale layout, engine refusal — before any early return.
    const session = sessionRef.current;
    sessionRef.current = null;

    if (event.canceled || session === null) {
      setDragging(false);
      if (session !== null) {
        clearPeerPreview(session);
      }
      return;
    }

    // Grid geometry changed mid-drag: the pixel space the user aimed at no
    // longer exists, so the commit is invalidated.
    const currentMetrics = metricsRef.current;
    if (
      currentMetrics === null ||
      !areGridPixelMetricsEqual(currentMetrics, session.metricsAtStart)
    ) {
      setDragging(false);
      clearPeerPreview(session);
      return;
    }

    // The layout this drag started from is no longer the current one: the
    // session is stale and must not commit against a newer world.
    if (layoutRef.current !== session.layoutAtStart) {
      setDragging(false);
      clearPeerPreview(session);
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

    // Rigid group translation; single-item sessions resolve identically to
    // the engine's moveItem.
    const translation = translationFromDesired(session.startPosition, desired);
    const result =
      session.itemIds.length === 1
        ? moveItem(session.layoutAtStart, session.sourceItemId, desired, {
            placement: "nearest-free",
          })
        : moveItems(session.layoutAtStart, session.itemIds, translation, {
            placement: "nearest-free",
          });
    // On a valid drop, onCommit runs BEFORE the drag teardown: the consumer
    // establishes its optimistic display layout synchronously there, so the
    // dnd-kit transform release and the peer preview clear paint directly
    // into the destination cells (zero-bounce handoff). The peer clear is
    // deferred to the post-render layout effect so it cannot paint one
    // frame ahead of the moved grid.
    if (result.ok) {
      onCommitRef.current(result.layout, session.layoutAtStart);
    }
    setDragging(false);
    if (result.ok) {
      pendingPeerClearRef.current = session;
    } else {
      clearPeerPreview(session);
    }
  };

  return { dragging, handleDragStart, handleDragMove, handleDragEnd };
}
