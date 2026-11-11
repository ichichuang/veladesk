"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { pageItemIds, resolvePagePlacement } from "@veladesk/domain";
import type {
  DesktopPage,
  DesktopPageId,
  EntityId,
  PagePlacement,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LayoutItemId } from "@veladesk/desktop-engine";

import { resolveDragItemIds } from "../../desktop-grid/group-drag";
import { useCanvasDrag } from "../../canvas/use-canvas-drag";
import { useCanvasMetrics } from "../../canvas/use-canvas-metrics";
import { fluidGridCellCap } from "../../canvas/square-grid-metrics";
import { useSquareGridMetrics } from "../../canvas/use-square-grid-metrics";
import type { GridItemGeometry } from "../../canvas/canvas-resize";
import { scopedToLayer } from "../section-layer-query";
import { normalizeSelection, toggleSelection } from "../selection-state";
import { normalizeSelectionRect, selectIntersectingItemIds } from "../selection-geometry";
import { seedPageCanvasHistory } from "../../canvas/arrange-history";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { TranslateFn } from "../../i18n/use-i18n";
import { useSnapDropRipples } from "./drop-ripple";
import { recordDragReleaseBox } from "../dnd-static-drop";
import { useCanvasCommits } from "./use-canvas-commits";

interface MarqueeState {
  readonly startX: number;
  readonly startY: number;
  readonly currentX: number;
  readonly currentY: number;
  readonly additive: boolean;
}

export const EMPTY_SELECTION: ReadonlySet<LayoutItemId> = new Set();
export const EMPTY_ID_SET: ReadonlySet<EntityId> = new Set();

export interface UseTileSessionInput {
  readonly runtime: WorkspaceClientRuntime;
  /** The authoritative snapshot (resizable-id entity lookup, handoff dep). */
  readonly snapshot: WorkspaceSnapshot;
  /** Latest-value mirror of the workspace record (staged edits). */
  readonly workspaceRef: RefObject<LocalWorkspaceRecord>;
  /** Latest-value mirror of the effective active page id. */
  readonly pageIdRef: RefObject<DesktopPageId | null>;
  /** The i18n translate function (placement-mode refusal strings). */
  readonly t: TranslateFn;
  /** The active section's page (undefined only in the no-pages fallback). */
  readonly activePage: DesktopPage | undefined;
  /** True while the desktop is in arrange mode. */
  readonly arrange: boolean;
  /** The effective active section id. */
  readonly effectiveActivePageId: DesktopPageId | null;
  /** The effective grid gap (session preview ?? persisted). */
  readonly displayGapPx: number;
  /** The section viewport element (marquee hit-testing scope). */
  readonly viewportRef: RefObject<HTMLDivElement | null>;
}

/**
 * The tile host's interactive SESSION (P1-ENG-1): the arrange selection,
 * the marquee (rubber-band) gesture, the canvas drag wiring (dnd-kit), the
 * freeform/grid measurement refs and the grid target-slot feedback — every
 * pointer-level concern of the ACTIVE section's tiles. Extracted verbatim
 * from the former desktop-shell.tsx; geometry COMMITS flow through
 * {@link useCanvasCommits}, never staged from here.
 */
export function useTileSession(input: UseTileSessionInput) {
  const {
    runtime,
    snapshot,
    workspaceRef,
    pageIdRef,
    t,
    activePage,
    arrange,
    effectiveActivePageId,
    displayGapPx,
    viewportRef,
  } = input;

  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlySet<LayoutItemId>>(EMPTY_SELECTION);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  const selectionRef = useRef(selectedItemIds);
  const draggingRef = useRef(false);
  const lastDragEndedAtRef = useRef(0);
  const marqueeOriginRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  // The snap-drop ripple session (P1, motion-spec §3): landing cells of a
  // committed Grid drag, rendered by the grid stage as one-shot rings.
  const { ripples: snapDropRipples, playSnapDrop } = useSnapDropRipples();

  // The canvas command layer (geometry commits, handoff, arrange history).
  // Called here — after the selection state it reads, before the drag
  // wiring that commits through it — so one hook owns every tile-level
  // concern and the shell gets a single composed session.
  const commits = useCanvasCommits({
    runtime,
    snapshot,
    workspaceRef,
    pageIdRef,
    activePage,
    selectionRef,
    t,
  });
  const {
    handoffLock,
    pendingHandoffRef,
    resizeLockRef,
    displayPlacement,
    setArrangeHistories,
    commitDraggedCanvas,
  } = commits;

  function applySelection(next: ReadonlySet<LayoutItemId>) {
    selectionRef.current = next;
    setSelectedItemIds(next);
  }

  /**
   * The active section moved: the arrange selection belongs to the section
   * it was made on, so it never crosses sections.
   */
  const previousActiveRef = useRef<DesktopPageId | null>(effectiveActivePageId);
  useEffect(() => {
    if (previousActiveRef.current !== effectiveActivePageId) {
      previousActiveRef.current = effectiveActivePageId;
      if (selectionRef.current.size > 0) {
        applySelection(EMPTY_SELECTION);
      }
    }
  }, [effectiveActivePageId]);

  /** Selection + history reconcile after every workspace/active-page change. */
  useEffect(() => {
    if (activePage === undefined) {
      return;
    }
    const validIds = new Set(pageItemIds(activePage));
    const normalized = normalizeSelection(selectionRef.current, validIds);
    if (normalized !== selectionRef.current) {
      applySelection(normalized);
    }
    setArrangeHistories((current) =>
      // SEED then reconcile (Helm r3): the baseline is the placement the
      // user saw when the page activated, so the FIRST edit is undoable.
      seedPageCanvasHistory(current, activePage.id, resolvePagePlacement(activePage)),
    );
  }, [activePage, setArrangeHistories]);

  // --- Metrics ---------------------------------------------------------------
  // Freeform measures the canvas box; Grid measures the stage width and
  // derives the square cells. Both hooks run unconditionally; their refs
  // only attach to whichever model the active section renders. The Grid
  // cell carries a viewport-FLUID ceiling (Helm r3): the spec floor
  // (GRID_CELL_MAX_PX, 96–112 band) holds on laptop stages and wide stages
  // let the cell breathe up to 160px, so a wide screen stops reading as a
  // tiny tile island. The cap feeds the SAME measuring hook — the stage
  // width is layout-fixed, so the second pass settles.
  const { canvasRef, metrics: freeformMetrics } = useCanvasMetrics();
  const activeColumns =
    displayPlacement !== null && displayPlacement.mode === "grid" ? displayPlacement.columns : 0;
  const { stageRef: gridStageRef, metrics: gridMetrics } = useSquareGridMetrics(
    activeColumns,
    displayGapPx,
    // The cap is a FUNCTION of the measured stage width, resolved inside
    // the measurement itself — the stage width is layout-fixed (the
    // centered frame never feeds back into it), so this converges in one
    // pass with no extra state or effect.
    fluidGridCellCap,
  );

  // --- Grid target-slot feedback (task 017-B) ---------------------------------
  // The resolved cells a live drag aims at, plus the live integer preview of
  // a resize. Reported only on integer-geometry changes; every gesture exit
  // path (cancel, invalidation, no-op, commit, unmount) reports null, and
  // the derived array below additionally gates on arrange — no effect-driven
  // clearing needed.
  const [dragTargetBoxes, setDragTargetBoxes] = useState<readonly GridItemGeometry[] | null>(null);
  const [resizeTargetBox, setResizeTargetBox] = useState<GridItemGeometry | null>(null);
  const gridFeedbackBoxes =
    arrange && displayPlacement !== null && displayPlacement.mode === "grid"
      ? [
          ...(dragTargetBoxes ?? []),
          ...(resizeTargetBox !== null ? [resizeTargetBox] : []),
        ]
      : undefined;

  /** Resolves a tile's element scoped to the ACTIVE page's own layer. */
  const resolveItemElement = useCallback((itemId: LayoutItemId) => {
    // Scoped to the ACTIVE page's own layer (021-R1): warm layers render
    // real items with the same data-item-id attributes, and a hidden
    // page's element must never win a document-wide lookup.
    const pageId = pageIdRef.current;
    const scope = viewportRef.current?.querySelector(
      scopedToLayer(pageId, `[data-item-id="${CSS.escape(itemId)}"]`) ?? ""
    );
    return scope instanceof HTMLElement ? scope : null;
  }, [pageIdRef, viewportRef]);

  /**
   * The ACTIVE section's scroller (t63): the drag session tracks its
   * scrollTop and grows its runway so a drag can push content below the
   * first viewport and dnd-kit's auto-scroll always has room.
   */
  const resolveScroller = useCallback(() => {
    const pageId = pageIdRef.current;
    const scroller = viewportRef.current?.querySelector(
      scopedToLayer(pageId, ".vela-section-scroller") ?? ""
    );
    return scroller instanceof HTMLElement ? scroller : null;
  }, [pageIdRef, viewportRef]);

  const { dragging, handleDragStart, handleDragMove, handleDragEnd } = useCanvasDrag({
    placement: displayPlacement,
    metrics: freeformMetrics,
    pitchPx: gridMetrics?.pitchPx ?? null,
    resolveScroller,
    onCommit: useCallback(
      (moved: PagePlacement, placementAtStart: PagePlacement) => {
        commitDraggedCanvas(moved, placementAtStart);
        // The ripple rides the committed placement — one ring per landing
        // cell, never rendered under reduced motion (inside the hook).
        playSnapDrop(moved, placementAtStart);
      },
      [commitDraggedCanvas, playSnapDrop],
    ),
    onGridTargetChange: setDragTargetBoxes,
    getDragItemIds: useCallback(
      (sourceId: LayoutItemId) => resolveDragItemIds(sourceId, selectionRef.current),
      []
    ),
    resolveItemElement,
  });
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  const wrappedHandleDragStart = useCallback(
    (event: Parameters<typeof handleDragStart>[0]) => {
      // A pending handoff means the durable snapshot is behind the display;
      // a second geometry session must not start on that base. A live icon
      // resize owns the pointer outright.
      if (pendingHandoffRef.current !== null || resizeLockRef.current) {
        return;
      }
      // Drag-source selection semantics: grabbing an unselected item makes
      // it the whole drag; grabbing a selected one drags the selection.
      const sourceId = event.operation.source?.id;
      if (sourceId !== undefined && !selectionRef.current.has(String(sourceId))) {
        applySelection(new Set([String(sourceId)]));
      }
      handleDragStart(event);
    },
    [handleDragStart, pendingHandoffRef, resizeLockRef]
  );

  const wrappedHandleDragEnd = useCallback(
    (event: Parameters<typeof handleDragEnd>[0]) => {
      lastDragEndedAtRef.current = Date.now();
      // The release VISUAL box must be captured while the drag state is
      // still live (fixed source + snap-corrected body) — by the time the
      // drop settle runs, the post-commit effects may already have cleared
      // the correction. Consumed by the settle in dnd-static-drop.ts.
      const sourceId = event.operation.source?.id;
      if (sourceId !== undefined) {
        const sourceElement = resolveItemElement(String(sourceId) as LayoutItemId);
        if (sourceElement !== null) {
          recordDragReleaseBox(sourceElement);
        }
      }
      handleDragEnd(event);
    },
    [handleDragEnd, resolveItemElement]
  );

  const handleItemSelect = useCallback((entityId: EntityId, toggle: boolean) => {
    // A drag releases the pointer with a click; never let it clobber the
    // group selection the drag just moved.
    if (Date.now() - lastDragEndedAtRef.current < 250) {
      return;
    }
    applySelection(toggle ? toggleSelection(selectionRef.current, entityId) : new Set([entityId]));
  }, []);

  // --- Arrange marquee (rubber-band) selection, active section only ---------
  const handleViewportPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!arrange || draggingRef.current || resizeLockRef.current || event.button !== 0) {
        return;
      }
      // Only the empty canvas background starts a marquee — never an item.
      if (event.target !== event.currentTarget) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      marqueeOriginRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      setMarquee({
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        additive: event.metaKey || event.ctrlKey,
      });
    },
    [arrange, resizeLockRef]
  );

  const handleViewportPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = marqueeOriginRef.current;
    if (origin === null || origin.pointerId !== event.pointerId) {
      return;
    }
    setMarquee((current) =>
      current === null
        ? current
        : { ...current, currentX: event.clientX, currentY: event.clientY },
    );
  }, []);

  const handleViewportPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = marqueeOriginRef.current;
      const state = marquee;
      if (origin === null || state === null || origin.pointerId !== event.pointerId) {
        return;
      }
      marqueeOriginRef.current = null;
      setMarquee(null);
      const moved = Math.hypot(state.currentX - state.startX, state.currentY - state.startY);
      if (moved < 4) {
        // Blank click: plain clears the selection, additive keeps it.
        if (!state.additive) {
          applySelection(EMPTY_SELECTION);
        }
        return;
      }
      // Scoped to the interactive page's own layer (021-R1) — never a
      // document-wide attribute lookup that a warm or exiting layer could
      // win.
      const marqueePageId = pageIdRef.current;
      const viewport =
        marqueePageId === null
          ? null
          : viewportRef.current?.querySelector(
              [
                scopedToLayer(marqueePageId, ".vela-grid-stage"),
                scopedToLayer(marqueePageId, ".vela-canvas"),
              ].join(", ")
            );
      if (viewport === null) {
        return;
      }
      const marqueeRect = normalizeSelectionRect(
        { left: state.startX, top: state.startY, right: state.startX, bottom: state.startY },
        {
          left: state.currentX,
          top: state.currentY,
          right: state.currentX,
          bottom: state.currentY,
        },
      );
      const items = Array.from(
        (viewport as HTMLElement).querySelectorAll<HTMLElement>("[data-item-id]"),
      ).map((element) => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.itemId ?? "", rect };
      });
      const hitIds = selectIntersectingItemIds(items, marqueeRect);
      const next = new Set(state.additive ? selectionRef.current : new Set<string>());
      for (const id of hitIds) {
        if (id) {
          next.add(id);
        }
      }
      applySelection(next);
    },
    [marquee, pageIdRef, viewportRef]
  );

  /**
   * The resizable items of the active section: exactly one selected app.
   *
   * A LIVE session must never remove the handles — they hold the pointer
   * capture, so unmounting them would drop the gesture mid-drag. Only a
   * pending geometry handoff suppresses them (and then the gesture is
   * already over), which also stops a second session from starting on a
   * rect the snapshot has not caught up with yet.
   */
  const resizableIds = useMemo<ReadonlySet<EntityId>>(() => {
    if (!arrange || activePage === undefined || handoffLock) {
      return EMPTY_ID_SET;
    }
    if (selectedItemIds.size !== 1) {
      return EMPTY_ID_SET;
    }
    const [id] = selectedItemIds;
    if (id === undefined) {
      return EMPTY_ID_SET;
    }
    const entity = snapshot.entities.find((candidate) => candidate.id === id);
    // Folders and widgets keep their default size: the product resizes app
    // tiles, and a group selection has no handles at all.
    return entity !== undefined && entity.kind === "app" ? new Set([id]) : EMPTY_ID_SET;
  }, [activePage, arrange, handoffLock, selectedItemIds, snapshot.entities]);

  return {
    // The canvas command layer (also consumed by the shell: menus, toolbar,
    // keyboard shortcuts, scene resize-lock input).
    commits,
    // Selection + gestures.
    selectedItemIds,
    applySelection,
    selectionRef,
    dragging,
    draggingRef,
    marquee,
    handleViewportPointerDown,
    handleViewportPointerMove,
    handleViewportPointerUp,
    // dnd-kit wiring (consumed by the shell's DragDropProvider).
    wrappedHandleDragStart,
    handleDragMove,
    wrappedHandleDragEnd,
    handleItemSelect,
    // Measurement + feedback (consumed by the tile layers).
    canvasRef,
    gridStageRef,
    freeformMetrics,
    gridMetrics,
    gridFeedbackBoxes,
    resizeTargetBox,
    setResizeTargetBox,
    resizableIds,
    // The snap-drop ripple session (rendered by the active grid stage).
    snapDropRipples,
  };
}

/** The interactive tile session returned by {@link useTileSession}. */
export type TileSession = ReturnType<typeof useTileSession>;
