"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/react";
import { areCanvasLayoutsEqual } from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";
import type { LayoutItemId } from "@veladesk/desktop-engine";

import type { CanvasPixelMetrics } from "./canvas-metrics";
import {
  commitCanvasDrag,
  gridReflowPreviewPlacement,
  gridTranslationOf,
} from "./canvas-drag";
import type { GridItemGeometry } from "./canvas-resize";

/** Custom property the item body moves with during a drag preview. */
export const CANVAS_DRAG_PREVIEW_VAR = "--vd-canvas-drag-preview";

/**
 * Custom property that grows the active section's scrollable content while a
 * drag pushes toward (or past) the bottom edge (t63 "air wall" fix): the
 * runway element inside the stage reads it. Set on the section scroller, in
 * CSS pixels; absent/0 when no drag needs it.
 */
export const CANVAS_RUNWAY_VAR = "--vd-canvas-runway";

/** Extra scrollable room kept below the drag's implied bottom edge, px. */
const RUNWAY_MARGIN_PX = 160;

interface ActiveCanvasDragSession {
  readonly sourceItemId: LayoutItemId;
  readonly itemIds: readonly LayoutItemId[];
  readonly placementAtStart: PagePlacement;
  /** Freeform: the canvas pixel box at start. Grid: null. */
  readonly metricsAtStart: CanvasPixelMetrics | null;
  /** Grid: the cell pitch at start. Freeform: null. */
  readonly pitchAtStart: number | null;
  /** The section scroller this drag can scroll (t63), or null. */
  readonly scroller: HTMLElement | null;
  /** scroller.scrollTop when the session started. */
  readonly scrollTopAtStart: number;
  /** The source's bottom edge in scroller CONTENT coordinates at start. */
  readonly sourceBottomInContentAtStart: number;
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
  /**
   * Grid-only Apple-style reflow preview (t129): reports the placement the
   * bystanders should render at RIGHT NOW — dragged slots at their origin,
   * everyone the dragged set covers reflowed toward the vacated cells —
   * deduped per integer delta change exactly like the target boxes. `null`
   * on every gesture exit path, ALWAYS before the commit callback so the
   * commit render replaces the preview in one paint. The consumer feeds it
   * to the tile layer, where the snap FLIP slots spring the yielding tiles
   * live (reduced motion repositions them instantly).
   */
  readonly onGridReflowChange?:
    | ((placement: PagePlacement | null) => void)
    | undefined;
  /**
   * Resolves the ACTIVE section's scroller (t63): the scroll container a
   * drag can push content through — the drag session tracks its scrollTop
   * (dnd-kit's auto-scroll moves it while the pointer rides the bottom
   * edge) and grows the scroll runway so the edge is always reachable.
   */
  readonly resolveScroller?: (() => HTMLElement | null) | undefined;
}

/**
 * The canvas drag session.
 *
 * dnd-kit owns the pointer-follow transform of the dragged source — the
 * fixed source element rides the RAW pointer delta every frame, and since
 * the t61 drag rework NOTHING cancels it: the tile the user holds always
 * sits under the pointer (grab offset preserved), even outside the grid,
 * over the header or the dock. This hook owns everything else: it
 * snapshots the placement, metrics/pitch and the moving ids at drag start,
 * translates the PEERS with the same raw delta (a rigid group), reports
 * the resolved grid target cells for the drop placeholder — driven by
 * NATIVE pointermove positions, because the 0.5 DragMoveEvent payload
 * lags the real pointer by one event — and commits each drag exactly once
 * at drop time (grid: whole cells; freeform: continuous, clamped at the
 * canvas origin and — since t63 — unbounded below the first viewport, with
 * the scroller's own travel added to the pointer delta so a drop below the
 * fold lands exactly where the user aimed).
 *
 * The resolved (snapped/clamped) translation drives the drop placeholder,
 * the BYSTANDER reflow preview (t129 — every tile the dragged set covers
 * reflows live toward the vacated cells; see onGridReflowChange) and the
 * commit at release, with the settle (dnd-static-drop.ts) gliding from the
 * release position into the committed geometry.
 *
 * Pointermove NEVER stages or persists anything — the peer preview is a
 * CSS custom property write, and the single durable commit happens on
 * pointerup.
 */
export function useCanvasDrag({
  placement,
  metrics,
  pitchPx,
  onCommit,
  getDragItemIds,
  resolveItemElement,
  onGridTargetChange,
  onGridReflowChange,
  resolveScroller,
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
  const onGridReflowChangeRef = useRef(onGridReflowChange);
  const resolveScrollerRef = useRef(resolveScroller);
  const lastTargetKeyRef = useRef<string | null>(null);
  /** The last reported reflow preview (structural-equality dedupe). */
  const lastReflowRef = useRef<PagePlacement | null>(null);
  /** dnd-kit's delta origin, captured from the first DragMoveEvent. */
  const dragInitialRef = useRef<{ x: number; y: number } | null>(null);
  /** Latest native pointermove position while a session is live. */
  const livePointerRef = useRef<{ x: number; y: number } | null>(null);
  /** Whether this session ever saw a native pointer move. */
  const sawNativePointerRef = useRef(false);
  const nativeMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);
  /** The runway height currently written to the scroller, px (t63). */
  const runwayPxRef = useRef(0);
  /** The scroller whose runway var awaits the post-commit clear (t63). */
  const runwayScrollerRef = useRef<HTMLElement | null>(null);
  const scrollHandlerRef = useRef<(() => void) | null>(null);
  const edgeFrameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (edgeFrameRef.current !== null) cancelAnimationFrame(edgeFrameRef.current);
    if (nativeMoveHandlerRef.current !== null) window.removeEventListener("pointermove", nativeMoveHandlerRef.current, { capture: true });
    const session = sessionRef.current;
    if (session?.scroller && scrollHandlerRef.current) session.scroller.removeEventListener("scroll", scrollHandlerRef.current);
    session?.scroller?.style.removeProperty(CANVAS_RUNWAY_VAR);
    runwayScrollerRef.current?.style.removeProperty(CANVAS_RUNWAY_VAR);
    sessionRef.current = null;
  }, []);

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
    resolveScrollerRef.current = resolveScroller;
  });
  useEffect(() => {
    onGridTargetChangeRef.current = onGridTargetChange;
  });
  useEffect(() => {
    onGridReflowChangeRef.current = onGridReflowChange;
  });

  // Zero-bounce handoff: the drop render (with the consumer's optimistic
  // placement) commits first, then the transient preview is dropped — both
  // land in the same paint, so the tiles never flash back to the old
  // geometry. The drag runway (t63) clears in the same breath: by now the
  // committed placement's own box carries the scroll extent, so removing
  // the runway can never clamp scrollTop back above the drop.
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
    const runwayScroller = runwayScrollerRef.current;
    if (runwayScroller !== null) {
      runwayScrollerRef.current = null;
      if (runwayPxRef.current !== 0) {
        runwayScroller.style.removeProperty(CANVAS_RUNWAY_VAR);
        runwayPxRef.current = 0;
      }
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
   * How far the section scroller moved since the session started (t63).
   * dnd-kit's auto-scroll (and a mid-drag wheel) advance scrollTop while the
   * pointer stays in client space, so every canvas-space delta — the peer
   * preview, the grid target cells, the commit — must add this on top of the
   * raw pointer delta or the drop would land short of where the user aimed.
   */
  function scrollDeltaOf(session: ActiveCanvasDragSession): number {
    return session.scroller === null
      ? 0
      : session.scroller.scrollTop - session.scrollTopAtStart;
  }

  /**
   * Grows (and shrinks) the drag runway (t63): an invisible extent anchored
   * at the stage's content origin whose TOTAL height reaches the drag's
   * implied bottom edge + margin, so dnd-kit's auto-scroll never runs out
   * of room and the pointer can push content below the first viewport. The
   * total-height form is deliberate — it never reads scrollHeight, so there
   * is no feedback loop with the extent it creates. Idempotent per frame.
   */
  function updateRunway(session: ActiveCanvasDragSession, effectiveDeltaY: number): void {
    const scroller = session.scroller;
    if (scroller === null) {
      return;
    }
    const needed = Math.ceil(
      session.sourceBottomInContentAtStart + effectiveDeltaY + RUNWAY_MARGIN_PX,
    );
    if (needed === runwayPxRef.current) {
      return;
    }
    runwayPxRef.current = needed;
    scroller.style.setProperty(CANVAS_RUNWAY_VAR, `${needed}px`);
  }

  /**
   * Detaches the scroll listener at gesture end (t63). The runway VAR is
   * cleared later — in the post-commit layout effect — because removing it
   * before the committed placement renders would briefly shrink the scroll
   * extent and the browser would clamp scrollTop down past the drop.
   */
  function tearDownScrollTracking(session: ActiveCanvasDragSession): void {
    if (edgeFrameRef.current !== null) cancelAnimationFrame(edgeFrameRef.current);
    edgeFrameRef.current = null;
    if (scrollHandlerRef.current !== null) {
      session.scroller?.removeEventListener("scroll", scrollHandlerRef.current);
      scrollHandlerRef.current = null;
    }
    runwayScrollerRef.current = session.scroller;
  }

  /**
   * Target-slot feedback: the resolved boxes of the moving items at the
   * current integer delta. Reported only when the delta actually crossed a
   * cell boundary — a setState per crossing, never per pointer frame. The
   * same crossing also recomputes the Apple-style reflow preview (t129):
   * the bystanders' live placement, deduped structurally against the last
   * report so an unchanged reflow never re-renders the tile layer.
   */
  function reportGridTargets(
    session: ActiveCanvasDragSession,
    columnDelta: number,
    rowDelta: number,
    deltaX: number,
    effectiveDeltaY: number,
  ): void {
    const callback = onGridTargetChangeRef.current;
    const reflowCallback = onGridReflowChangeRef.current;
    if (
      (callback === undefined && reflowCallback === undefined) ||
      session.placementAtStart.mode !== "grid"
    ) {
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
    if (key !== lastTargetKeyRef.current && callback !== undefined) {
      callback(boxes);
    }
    if (key !== lastTargetKeyRef.current && reflowCallback !== undefined) {
      const preview = gridReflowPreviewPlacement({
        placement: session.placementAtStart,
        itemIds: session.itemIds,
        deltaX,
        deltaY: effectiveDeltaY,
        metrics: session.metricsAtStart ?? { width: 1, height: 1 },
        pitchPx: session.pitchAtStart ?? 1,
      });
      if (
        lastReflowRef.current === null ||
        !areCanvasLayoutsEqual(preview, lastReflowRef.current)
      ) {
        lastReflowRef.current = preview;
        reflowCallback(preview);
      }
    }
    lastTargetKeyRef.current = key;
  }

  /** Clears both feedback channels (idempotent). */
  function reportTargets(value: null): void {
    lastTargetKeyRef.current = null;
    onGridTargetChangeRef.current?.(value);
    if (lastReflowRef.current !== null) {
      lastReflowRef.current = null;
      onGridReflowChangeRef.current?.(null);
    }
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

    // t63: the section scroller this drag may push content through. Its
    // scrollTop at start plus the source's content-space bottom edge feed
    // the scroll compensation and the drag runway. The runway's coordinate
    // origin is the STAGE (the scroller's content child) — its padding-top
    // band would otherwise offset every runway height by the Helm header.
    const scroller = resolveScrollerRef.current?.() ?? null;
    let scrollTopAtStart = 0;
    let sourceBottomInContentAtStart = Number.POSITIVE_INFINITY;
    if (scroller !== null) {
      scrollTopAtStart = scroller.scrollTop;
      const stage = scroller.firstElementChild;
      const sourceElement = resolveItemElementRef.current?.(sourceId);
      if (
        stage instanceof HTMLElement &&
        sourceElement !== null &&
        sourceElement !== undefined
      ) {
        sourceBottomInContentAtStart =
          (sourceElement as HTMLElement).getBoundingClientRect().bottom -
          stage.getBoundingClientRect().top;
      }
    }

    sessionRef.current = {
      sourceItemId: sourceId,
      itemIds: requested,
      placementAtStart: currentPlacement,
      metricsAtStart: currentMetrics,
      pitchAtStart: currentPitch,
      scroller,
      scrollTopAtStart,
      sourceBottomInContentAtStart,
    };
    dragInitialRef.current = null;
    sawNativePointerRef.current = false;
    attachNativePointerTracking(sessionRef.current);
    setDragging(true);
  };

  /**
   * Writes the drag preview (peer transforms + target feedback) for one
   * raw pointer delta. The SOURCE gets no correction var at all: dnd-kit's
   * fixed element already carries the exact raw delta, and a correction
   * here would pin the visible tile to its resolved cell instead of the
   * pointer — the t61 "doesn't follow my hand" artifact (at its worst for
   * large tiles and clamped directions, where the resolved cell never
   * changes and the correction cancels the whole drag).
   *
   * t63: the delta handed to the CANVAS-space consumers (peers, grid
   * targets, runway) is the raw pointer delta PLUS the scroller's travel —
   * peers are content-positioned, so while auto-scroll moves the scroller
   * under the fixed source they must ride the extra distance to stay a
   * rigid group with the pointer.
   */
  function runPreview(session: ActiveCanvasDragSession, deltaX: number, deltaY: number): void {
    const effectiveDeltaY = deltaY + scrollDeltaOf(session);
    for (const id of session.itemIds) {
      if (id === session.sourceItemId) {
        continue;
      }
      writePreview(id, `translate3d(${deltaX}px, ${effectiveDeltaY}px, 0)`);
    }
    if (session.placementAtStart.mode === "grid") {
      // The resolved whole-cell delta drives the drop placeholder, the
      // bystander reflow preview and the commit below — the dragged tiles
      // themselves ride the raw delta under the pointer.
      const { columnDelta, rowDelta } = gridTranslationOf({
        placement: session.placementAtStart,
        itemIds: session.itemIds,
        deltaX,
        deltaY: effectiveDeltaY,
        metrics: session.metricsAtStart ?? { width: 1, height: 1 },
        pitchPx: session.pitchAtStart ?? 1,
      });
      reportGridTargets(session, columnDelta, rowDelta, deltaX, effectiveDeltaY);
    }
    updateRunway(session, effectiveDeltaY);
  }

  /**
   * The drag preview is driven by NATIVE pointermove positions, not by
   * DragMoveEvent.operation.position: in @dnd-kit/react 0.5 the event's
   * `current` lags the real pointer by one event (observed mid-gesture in
   * the browser), so a correction computed from it visibly misses the
   * snapped cell until the pointer stops. Native moves are exact — the
   * peer preview and the grid target feedback ride them frame by frame —
   * and the event's `initial` is still the authoritative delta origin,
   * captured once on the first move event (native moves that arrive
   * earlier are replayed against it).
   */
  function attachNativePointerTracking(session: ActiveCanvasDragSession): void {
    const handler = (event: PointerEvent) => {
      const live = sessionRef.current;
      if (live === null) {
        return;
      }
      sawNativePointerRef.current = true;
      livePointerRef.current = { x: event.clientX, y: event.clientY };
      const initial = dragInitialRef.current;
      if (initial === null) {
        return;
      }
      runPreview(live, event.clientX - initial.x, event.clientY - initial.y);
    };
    nativeMoveHandlerRef.current = handler;
    window.addEventListener("pointermove", handler, { capture: true });

    // t63: while dnd-kit's auto-scroll (or a wheel) advances the scroller
    // under a still pointer, the preview and the runway must track the new
    // content offset every frame — the pointermove stream alone would never
    // fire.
    if (session.scroller !== null) {
      const onScroll = () => {
        const live = sessionRef.current;
        const initial = dragInitialRef.current;
        const pointer = livePointerRef.current;
        if (live === null || initial === null || pointer === null) {
          return;
        }
        runPreview(live, pointer.x - initial.x, pointer.y - initial.y);
      };
      scrollHandlerRef.current = onScroll;
      session.scroller.addEventListener("scroll", onScroll, { passive: true });
      // dnd-kit may retain only the ancestors present before the runway
      // overflows. Drive the active canvas edge explicitly, in client space.
      let previousTime = performance.now();
      const tick = (time: number) => {
        const live = sessionRef.current;
        const pointer = livePointerRef.current;
        const initial = dragInitialRef.current;
        if (live === null || live.scroller === null) return;
        if (pointer !== null && initial !== null) {
          const bounds = live.scroller.getBoundingClientRect();
          const band = 96;
          const down = Math.max(0, Math.min(1, (pointer.y - (bounds.bottom - band)) / band));
          const up = Math.max(0, Math.min(1, (bounds.top + band - pointer.y) / band));
          if (pointer.x >= bounds.left && pointer.x <= bounds.right) {
            updateRunway(live, pointer.y - initial.y + scrollDeltaOf(live));
            live.scroller.scrollTop += (down * down - up * up) * 900 * Math.min(32, time - previousTime) / 1000;
          }
        }
        previousTime = time;
        edgeFrameRef.current = requestAnimationFrame(tick);
      };
      edgeFrameRef.current = requestAnimationFrame(tick);
    }
  }

  function detachNativePointerTracking(): void {
    if (edgeFrameRef.current !== null) cancelAnimationFrame(edgeFrameRef.current);
    edgeFrameRef.current = null;
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
    // The release delta is captured BEFORE the tracking teardown clears
    // the live pointer: the LAST native pointermove is where the user let
    // go (the dragend payload lags it by one event in @dnd-kit/react 0.5).
    const releaseFromLive =
      sawNativePointerRef.current &&
      livePointerRef.current !== null &&
      dragInitialRef.current !== null
        ? {
            x: livePointerRef.current.x - dragInitialRef.current.x,
            y: livePointerRef.current.y - dragInitialRef.current.y,
          }
        : null;
    detachNativePointerTracking();
    dragInitialRef.current = null;
    sawNativePointerRef.current = false;

    if (event.canceled || session === null) {
      if (session !== null) {
        tearDownScrollTracking(session);
        clearPreview(session);
        reportTargets(null);
      }
      setDragging(false);
      return;
    }

    // The pixel space the user aimed at changed mid-drag (width resize in
    // freeform, pitch change in grid): the commit is invalidated.
    const isGrid = session.placementAtStart.mode === "grid";
    if (isGrid) {
      if (pitchRef.current === null || pitchRef.current !== session.pitchAtStart) {
        tearDownScrollTracking(session);
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
      tearDownScrollTracking(session);
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
      tearDownScrollTracking(session);
      setDragging(false);
      clearPreview(session);
      reportTargets(null);
      return;
    }

    // The commit delta prefers the captured native release position over
    // the dragend payload (one event behind the real pointer).
    const deltaX =
      releaseFromLive !== null
        ? releaseFromLive.x
        : event.operation.position.current.x - event.operation.position.initial.x;
    const deltaY =
      releaseFromLive !== null
        ? releaseFromLive.y
        : event.operation.position.current.y - event.operation.position.initial.y;
    // t63: the pointer stayed in client space while the scroller traveled —
    // the canvas-space drop is where the pointer aimed PLUS that travel.
    const scrollDelta = scrollDeltaOf(session);
    const moved = commitCanvasDrag({
      placement: session.placementAtStart,
      itemIds: session.itemIds,
      deltaX,
      deltaY: deltaY + scrollDelta,
      metrics: session.metricsAtStart ?? { width: 1, height: 1 },
      pitchPx: session.pitchAtStart ?? 1,
    });

    tearDownScrollTracking(session);
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
