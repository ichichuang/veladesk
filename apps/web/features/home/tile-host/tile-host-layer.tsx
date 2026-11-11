"use client";

import { memo, useMemo } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { resolvePagePlacement } from "@veladesk/domain";
import type {
  DesktopPage,
  DesktopPageId,
  EntityId,
  PagePlacement,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import type { ResizeCommitGeometry, GridItemGeometry } from "../../canvas/canvas-resize";
import type { CanvasPixelMetrics } from "../../canvas/canvas-metrics";
import type { SquareGridMetrics } from "../../canvas/square-grid-metrics";
import type { DropRipple } from "./drop-ripple";
import {
  deriveLayerPhase,
  interactiveActiveIdOf,
} from "../section-transition-machine";
import type { SectionNavMachine } from "../section-transition-machine";
import { SectionLayer, SectionView } from "../section-view";
import { EMPTY_ID_SET } from "./use-tile-session";
import "../home-shell.css";

interface TileHostLayerProps {
  readonly page: DesktopPage;
  readonly machine: SectionNavMachine;
  readonly activePageId: DesktopPageId | null;
  /** Handoff-aware placement, passed ONLY for the logical active page. */
  readonly displayPlacement: PagePlacement | null;
  readonly renderedWorkspace: WorkspaceSnapshot;
  readonly arrange: boolean;
  readonly dragEnabled: boolean;
  readonly scrollLocked: boolean;
  readonly appearanceEditingId: EntityId | null;
  readonly metrics: CanvasPixelMetrics | null;
  readonly gridMetrics: SquareGridMetrics | null;
  readonly canvasRef: ((node: HTMLDivElement | null) => void) | undefined;
  readonly gridStageRef: ((node: HTMLDivElement | null) => void) | undefined;
  readonly selectedIds: ReadonlySet<EntityId>;
  readonly resizableIds: ReadonlySet<EntityId>;
  readonly resizeActiveId: EntityId | null;
  readonly gridFeedbackBoxes: readonly GridItemGeometry[] | undefined;
  /** The live integer resize preview box (the badge's anchor, t77). */
  readonly resizeTargetBox: GridItemGeometry | null;
  /** Snap-drop ripple rings (active grid stage only, P1). */
  readonly snapDropRipples: readonly DropRipple[] | undefined;
  readonly initialScrollTop: number | undefined;
  readonly onResizeCommit: (entityId: EntityId, geometry: ResizeCommitGeometry) => void;
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  readonly onResizePreview: ((geometry: GridItemGeometry | null) => void) | undefined;
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onCanvasPointerDown?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerMove?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerUp?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  /** Layer registration for the GSAP pair coordinator (task 022). */
  readonly onLayerElement: (pageId: DesktopPageId, node: HTMLElement | null) => void;
}

/**
 * The TILE HOST layer (P1-ENG-1): one mounted section's tile surface —
 * the warm-layer wrapper, the section scroller, the desktop grid/canvas
 * items, drag/resize/selection wiring and the grid target feedback.
 * Formerly the shell's `SectionLayerSlot`, extracted VERBATIM; the layer
 * never imports the scene — the shell hands it the machine-derived phase
 * and the shared session callbacks as plain data.
 *
 * Memoized so a shell re-render skips warm layers entirely; only machine
 * events and this page's own data re-render it (020-A2 §18). During a cold
 * preparation the still-visible section stays interactive while the hidden
 * target measures.
 */
export const TileHostLayer = memo(function TileHostLayer({
  page,
  machine,
  activePageId,
  displayPlacement,
  renderedWorkspace,
  arrange,
  dragEnabled,
  scrollLocked,
  appearanceEditingId,
  metrics,
  gridMetrics,
  canvasRef,
  gridStageRef,
  selectedIds,
  resizableIds,
  resizeActiveId,
  gridFeedbackBoxes,
  resizeTargetBox,
  snapDropRipples,
  initialScrollTop,
  onResizeCommit,
  onResizeSessionChange,
  onResizePreview,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onLayerElement,
}: TileHostLayerProps) {
  const phase = deriveLayerPhase(machine, page.id, activePageId);
  const interactive = page.id === interactiveActiveIdOf(machine, activePageId);
  const ownPlacement = useMemo(() => resolvePagePlacement(page), [page]);
  const placement =
    page.id === activePageId && displayPlacement !== null ? displayPlacement : ownPlacement;
  return (
    <SectionLayer
      page={page}
      phase={phase}
      onLayerElement={onLayerElement}
    >
      <SectionView
        placement={placement}
        pageId={page.id}
        settledActive={phase === "active"}
        workspace={renderedWorkspace}
        active={interactive}
        appearanceEditingId={interactive ? appearanceEditingId : null}
        arrange={arrange}
        dragEnabled={dragEnabled}
        scrollLocked={scrollLocked}
        initialScrollTop={initialScrollTop}
        metrics={metrics}
        gridMetrics={gridMetrics}
        canvasRef={interactive ? canvasRef : undefined}
        gridStageRef={interactive ? gridStageRef : undefined}
        selectedIds={interactive ? selectedIds : EMPTY_ID_SET}
        resizableIds={interactive ? resizableIds : EMPTY_ID_SET}
        resizeActiveId={interactive ? resizeActiveId : null}
        onResizeCommit={onResizeCommit}
        onResizeSessionChange={onResizeSessionChange}
        onResizePreview={interactive ? onResizePreview : undefined}
        gridFeedbackBoxes={interactive ? gridFeedbackBoxes : undefined}
        resizeTargetBox={interactive ? resizeTargetBox : null}
        snapDropRipples={interactive ? snapDropRipples : undefined}
        onItemSelect={onItemSelect}
        onEntityContextMenu={onEntityContextMenu}
        onOpenFolder={onOpenFolder}
        onCanvasPointerDown={interactive ? onCanvasPointerDown : undefined}
        onCanvasPointerMove={interactive ? onCanvasPointerMove : undefined}
        onCanvasPointerUp={interactive ? onCanvasPointerUp : undefined}
      />
    </SectionLayer>
  );
});
