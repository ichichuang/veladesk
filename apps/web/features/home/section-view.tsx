"use client";

import { useLayoutEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DesktopPage, PagePlacement, WorkspaceSnapshot, EntityId } from "@veladesk/domain";

import { DesktopCanvasView } from "./desktop-grid";
import type { ResizeCommitGeometry, GridItemGeometry } from "../canvas/canvas-resize";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import type { SquareGridMetrics } from "../canvas/square-grid-metrics";
import "./home-shell.css";

/** Which transition phase a mounted section view is in. */
export type SectionViewPhase = "active" | "enter-next" | "enter-prev" | "exit-next" | "exit-prev";

interface SectionViewProps {
  readonly page: DesktopPage;
  readonly placement: PagePlacement;
  readonly workspace: WorkspaceSnapshot;
  /** True only for the active, interactive section. */
  readonly active: boolean;
  readonly phase: SectionViewPhase;
  readonly arrange: boolean;
  readonly dragEnabled: boolean;
  readonly scrollLocked: boolean;
  /** Saved scrollTop to restore on mount (session scroll memory). */
  readonly initialScrollTop: number | undefined;
  /** Reports this view's scroller element while it is the active view. */
  readonly onScrollerMount?: ((node: HTMLDivElement | null) => void) | undefined;
  readonly metrics: CanvasPixelMetrics | null;
  readonly gridMetrics: SquareGridMetrics | null;
  readonly canvasRef?: ((node: HTMLDivElement | null) => void) | undefined;
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
 * One section's slice of the right workspace: exactly one scroller owning
 * this section's vertical content scrolling (task 017).
 *
 * The active view mounts with a phase that animates the whole-page vertical
 * transition; an exiting view renders the same content read-only until the
 * transition completes, then unmounts. On mount the scroller restores the
 * section's remembered scrollTop — a transition never resets it.
 */
export function SectionView({
  page,
  placement,
  workspace,
  active,
  phase,
  arrange,
  dragEnabled,
  scrollLocked,
  initialScrollTop,
  onScrollerMount,
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

  // Restore the remembered scroll position on MOUNT, clamped into the
  // current scroll range (the content may have shrunk while away).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || !active) {
      return;
    }
    // Restore the remembered position, clamped into the CURRENT range. The
    // Grid rows only reach their square size after the metrics observer
    // reports the stage width (a layout later), so re-apply until the
    // content can satisfy the saved position — bounded, then silent.
    const desired = initialScrollTop ?? 0;
    let retry = 0;
    let timer = 0;
    const apply = () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.min(desired, Number.isFinite(max) ? Math.max(0, max) : 0);
    };
    apply();
    timer = window.setInterval(() => {
      retry += 1;
      apply();
      if (scroller.scrollTop >= desired - 1 || retry > 20) {
        window.clearInterval(timer);
      }
    }, 40);
    onScrollerMount?.(scroller);
    return () => {
      window.clearInterval(timer);
      onScrollerMount?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore runs exactly once per mount
  }, []);

  return (
    <section
      className="vela-section-view"
      data-page-id={page.id}
      data-active-section={active ? "true" : undefined}
      data-phase={phase}
      aria-label={page.name}
    >
      <div
        className="vela-section-scroller"
        data-vd-wheel-scope="section"
        data-scroll-locked={scrollLocked ? "true" : undefined}
        ref={scrollerRef}
      >
        <DesktopCanvasView
          placement={placement}
          workspace={workspace}
          arrange={arrange && active}
          dragEnabled={dragEnabled && active}
          metrics={active ? metrics : null}
          gridMetrics={active ? gridMetrics : null}
          canvasRef={active ? canvasRef : undefined}
          gridStageRef={active ? gridStageRef : undefined}
          selectedIds={active ? selectedIds : new Set()}
          resizableIds={active ? resizableIds : new Set()}
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
    </section>
  );
}
