"use client";

import { memo, useLayoutEffect, useRef, useCallback } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type {
  DesktopPage,
  DesktopPageId,
  PagePlacement,
  WorkspaceSnapshot,
  EntityId,
} from "@veladesk/domain";

import { DesktopCanvasView } from "./desktop-grid";
import type { SectionLayerPhase } from "./section-transition-machine";
import type { ResizeCommitGeometry, GridItemGeometry } from "../canvas/canvas-resize";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import type { SquareGridMetrics } from "../canvas/square-grid-metrics";
import "./home-shell.css";

interface SectionLayerProps {
  readonly page: DesktopPage;
  readonly phase: SectionLayerPhase;
  readonly children: ReactNode;
  /**
   * Registers this layer's wrapper element with the shell's pair
   * coordinator (task 022). The coordinator — not the layer — owns every
   * animation frame of the visible page pair, so the wrapper itself is a
   * plain, stable section: no pose machinery, no per-layer animation
   * binding, no remounts across transitions.
   */
  readonly onLayerElement?: ((pageId: DesktopPageId, node: HTMLElement | null) => void) | undefined;
}

/**
 * The lightweight page wrapper (020-A2, GSAP re-architecture 022): ALL
 * transition state lives in data attributes and the shell-owned pair
 * coordinator, while the SectionView content below stays mounted and
 * stable. The layer is keyed by the stable page id at the call site; no
 * transition nonce ever remounts it.
 *
 * Task 022: Motion and the per-layer driver binding are gone. The
 * {@link createSectionPairCoordinator} instance owned by the shell animates
 * the VISIBLE PAIR on one shared GSAP timeline (a real vertical page slide
 * over the measured viewport height, opacity 1 throughout); every other
 * phase is a pure CSS state (warm hiding, aria, inert). React owns the
 * lifecycle; the coordinator owns frames; nothing else touches the
 * wrapper's transform.
 *
 * Warm hiding is CSS-owned (visibility:hidden on data-warm-hidden) so a
 * prewarmed page keeps real geometry for measurement while never painting,
 * never taking pointers and never duplicating accessibility (inert +
 * aria-hidden). Reduced motion never reaches this component: the shell
 * swaps sections instantly and the machine never leaves idle.
 */
export function SectionLayer({ page, phase, children, onLayerElement }: SectionLayerProps) {
  const setLayerElement = useCallback(
    (node: HTMLElement | null) => {
      onLayerElement?.(page.id, node);
    },
    [page.id, onLayerElement],
  );

  return (
    <section
      ref={setLayerElement}
      className="vela-section-layer"
      data-page-id={page.id}
      data-phase={phase}
      data-warm-hidden={phase === "warm" ? "true" : undefined}
      data-transitioning={phase === "entering" || phase === "exit" ? "true" : undefined}
      data-active-section={phase === "active" || phase === "entering" ? "true" : undefined}
      aria-label={page.name}
      // The resting/entering page is announced; hidden and exiting pages are
      // not. Warm layers are additionally inert (no focus, no a11y tree).
      aria-hidden={
        phase === "active" || phase === "entering" ? undefined : ("true" as const)
      }
      inert={phase === "warm" ? true : undefined}
    >
      {children}
    </section>
  );
}

interface SectionViewProps {
  readonly placement: PagePlacement;
  readonly workspace: WorkspaceSnapshot;
  /** True only for the interactive (visible) section. */
  readonly active: boolean;
  /** The app the appearance inspector edits — quiet affordance (019-C). */
  readonly appearanceEditingId?: EntityId | null;
  readonly arrange: boolean;
  readonly dragEnabled: boolean;
  readonly scrollLocked: boolean;
  /** Saved scrollTop to restore on MOUNT (session scroll memory). */
  readonly initialScrollTop: number | undefined;
  /** Freeform: canvas pixel metrics — shared by every mounted layer. */
  readonly metrics: CanvasPixelMetrics | null;
  /** Grid: square-cell metrics — shared by every mounted layer. */
  readonly gridMetrics: SquareGridMetrics | null;
  /** Freeform measurement ref — attaches to the ACTIVE layer only. */
  readonly canvasRef?: ((node: HTMLDivElement | null) => void) | undefined;
  /** Grid measurement ref — attaches to the ACTIVE layer only. */
  readonly gridStageRef?: ((node: HTMLDivElement | null) => void) | undefined;
  readonly selectedIds: ReadonlySet<EntityId>;
  readonly resizableIds: ReadonlySet<EntityId>;
  readonly resizeActiveId: EntityId | null;
  readonly onResizeCommit: (entityId: EntityId, geometry: ResizeCommitGeometry) => void;
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  /** Grid target-slot feedback (active view only). */
  readonly onResizePreview?: ((geometry: GridItemGeometry | null) => void) | undefined;
  readonly gridFeedbackBoxes?: readonly GridItemGeometry[] | undefined;
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onCanvasPointerDown?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerMove?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerUp?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * One section's slice of the right workspace (task 017, motion rebuilt
 * 018, warm-mounted 020-A2): exactly one scroller owning this section's
 * vertical content scrolling.
 *
 * The view is STABLE across transitions (020-A2 §22): it mounts once per
 * warm-set membership — never per switch — and carries no transition key
 * or state; the SectionLayer wrapper owns all of that. The transform lives
 * on the wrapper ONLY; item/drag transforms inside DesktopCanvasView are
 * untouched, so dnd-kit keeps hard-snap ownership. Under reduced motion
 * the layer renders plain: switches are instant, nothing transforms.
 *
 * On MOUNT the scroller restores the section's remembered scrollTop — for
 * a warm page that already means it is correct while still hidden, so no
 * restore ever rides the reveal (020-A2 §30). A page that stays mounted
 * keeps its live scroller at the exact scrollTop it was left at; only an
 * evicted page re-runs this restore on its next mount.
 */
function SectionViewImpl({
  placement,
  workspace,
  active,
  appearanceEditingId,
  arrange,
  dragEnabled,
  scrollLocked,
  initialScrollTop,
  metrics,
  gridMetrics,
  canvasRef,
  gridStageRef,
  selectedIds,
  resizableIds,
  resizeActiveId,
  onResizeCommit,
  onResizeSessionChange,
  onResizePreview,
  gridFeedbackBoxes,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
}: SectionViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Restore the remembered scroll position ONCE PER MOUNT, clamped into
  // the current scroll range (the content may have shrunk while away).
  // Runs for hidden warm mounts too — the scroll is simply already right
  // when the page is revealed.
  //
  // Task 020-A1 §28: NO polling. The one legitimate reason a second write
  // is ever needed: grid rows reach their square size only after the
  // metrics observer reports the stage width — one layout later than
  // mount. So the restore re-applies only when the content element
  // actually RESIZES (ResizeObserver), and stops for good the moment the
  // saved position is reachable. Animation frames stay free of scroll
  // writes.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    const desired = initialScrollTop ?? 0;
    const apply = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.min(desired, Number.isFinite(max) ? Math.max(0, max) : 0);
    };
    apply();
    const content = scroller.firstElementChild;
    let observer: ResizeObserver | undefined;
    if (content !== null && typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => {
        if (scroller.scrollTop >= desired - 1) {
          observer?.disconnect();
          return;
        }
        apply();
      });
      observer.observe(content);
    }
    return () => {
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore runs exactly once per mount
  }, []);

  return (
    <div
      className="vela-section-scroller"
      data-vd-wheel-scope="section"
      data-scroll-locked={scrollLocked ? "true" : undefined}
      ref={scrollerRef}
    >
      <DesktopCanvasView
        placement={placement}
        workspace={workspace}
        appearanceEditingId={active ? (appearanceEditingId ?? null) : null}
        arrange={arrange && active}
        dragEnabled={dragEnabled && active}
        metrics={metrics}
        gridMetrics={gridMetrics}
        canvasRef={active ? canvasRef : undefined}
        gridStageRef={active ? gridStageRef : undefined}
        selectedIds={active ? selectedIds : EMPTY_ID_SET}
        resizableIds={active ? resizableIds : EMPTY_ID_SET}
        resizeActiveId={active ? resizeActiveId : null}
        onResizeCommit={onResizeCommit}
        onResizeSessionChange={onResizeSessionChange}
        onResizePreview={active ? onResizePreview : undefined}
        gridFeedbackBoxes={active ? gridFeedbackBoxes : undefined}
        onItemSelect={onItemSelect}
        onEntityContextMenu={onEntityContextMenu}
        onOpenFolder={onOpenFolder}
        onCanvasPointerDown={active ? onCanvasPointerDown : undefined}
        onCanvasPointerMove={active ? onCanvasPointerMove : undefined}
        onCanvasPointerUp={active ? onCanvasPointerUp : undefined}
      />
    </div>
  );
}

const EMPTY_ID_SET: ReadonlySet<EntityId> = new Set();

/**
 * Memoized: a warm (hidden) layer's content skips shell-driven re-renders
 * entirely — phase changes re-render only the lightweight SectionLayer
 * wrapper above (020-A2 §18).
 */
export const SectionView = memo(SectionViewImpl);
