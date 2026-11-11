"use client";

import { memo } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CanvasLayoutItem } from "@veladesk/canvas-engine";
import type { PagePlacement, WorkspaceSnapshot, EntityId } from "@veladesk/domain";

import { DesktopItem } from "./desktop-item";
import { GridSlotOverlay } from "./grid-slot-overlay";
import { GridTargetFeedback } from "./grid-target-feedback";
import { SnapDropRipples } from "./tile-host/drop-ripple";
import type { DropRipple } from "./tile-host/drop-ripple";
import type { ResizeCommitGeometry } from "../canvas/canvas-resize";
import type { GridItemGeometry } from "../canvas/canvas-resize";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import type { SquareGridMetrics } from "../canvas/square-grid-metrics";
import { gridFrameContentWidthPx, gridFrameTopOffsetPx } from "../canvas/square-grid-metrics";
import "./home-shell.css";

interface DesktopCanvasViewProps {
  readonly placement: PagePlacement;
  readonly workspace: WorkspaceSnapshot;
  /** The app the appearance inspector edits — quiet affordance (019-C). */
  readonly appearanceEditingId?: EntityId | null;
  /**
   * Whether THIS section runs the arrange session. Only the active section
   * arranges (task 015 rule kept) — passing `arrange` already implies the
   * section is active.
   */
  readonly arrange: boolean;
  /**
   * Whether items may start drag sessions at all. Independent of `arrange`:
   * a pending drop handoff briefly disables new drags without pretending the
   * desktop left arrange mode. Inactive/exiting sections always render with
   * drags off.
   */
  readonly dragEnabled: boolean;
  /** Freeform: canvas pixel metrics — only the active section is measured. */
  readonly metrics: CanvasPixelMetrics | null;
  /** Grid: square-cell metrics — only the active section is measured. */
  readonly gridMetrics: SquareGridMetrics | null;
  /** Freeform measurement ref (attaches to `.vela-canvas`). */
  readonly canvasRef?: ((node: HTMLDivElement | null) => void) | undefined;
  /** Grid measurement ref (attaches to `.vela-grid-stage`). */
  readonly gridStageRef?: ((node: HTMLDivElement | null) => void) | undefined;
  readonly selectedIds: ReadonlySet<EntityId>;
  /**
   * The items that may show the eight resize handles this frame. The shell
   * owns the rule (arrange mode, single selection, an app).
   */
  readonly resizableIds: ReadonlySet<EntityId>;
  /** The app whose resize session or handoff is live, if any. */
  readonly resizeActiveId: EntityId | null;
  readonly onResizeCommit: (entityId: EntityId, geometry: ResizeCommitGeometry) => void;
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  /** Grid target-slot feedback: live resolved boxes during resize. */
  readonly onResizePreview?: ((geometry: GridItemGeometry | null) => void) | undefined;
  /** Grid target-slot feedback boxes (drag targets + resize preview). */
  readonly gridFeedbackBoxes?: readonly GridItemGeometry[] | undefined;
  /** Snap-drop ripple rings (P1, motion-spec §3). */
  readonly snapDropRipples?: readonly DropRipple[] | undefined;
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  /** Arrange-mode marquee: pointerdown on the canvas background. */
  readonly onCanvasPointerDown?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerMove?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerUp?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * One section's placed content — the task 017 dual renderer.
 *
 * GRID mode is a real CSS Grid: `repeat(columns, var(--vd-grid-cell-size))`
 * fixed cell tracks (so a shrink-wrapped frame can never compress the
 * stored columns), `grid-auto-rows: var(--vd-grid-cell-size)` rows and
 * `gap: var(--vd-grid-gap)`; content rows grow without a fixed row count,
 * so the section scroller (the parent) owns vertical scrolling. Since Helm
 * r2 the cell carries a spec ceiling, so the grid content may be NARROWER
 * than the stage: the `.vela-grid-frame` centers it and hosts the overlays
 * (see the render). In Arrange the frame paints the visible square slots
 * as one pointer-transparent SVG pattern (task 017-A) — isolated squares
 * separated by the real gap, never marker nodes, never a pointer target.
 *
 * FREEFORM keeps the continuous percent-space canvas: absolutely positioned
 * rects inside one viewport-height stage, exactly the pre-017 model.
 *
 * Pure rendering — drag sessions, selection state and context menus live in
 * the shell.
 */
export const DesktopCanvasView = memo(function DesktopCanvasView({
  placement,
  workspace,
  appearanceEditingId,
  arrange,
  dragEnabled,
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
  snapDropRipples,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
}: DesktopCanvasViewProps) {
  if (placement.mode === "grid") {
    // Layout-fill anchors (pure view layer — never stored geometry): the
    // frame width follows the span the content ACTUALLY occupies (a sparse
    // section centers by its real columns, not the stored full width), and
    // the vertical offset anchors the block between the header and the
    // dock instead of floating low-mid. Both need the measured metrics;
    // unmeasured first frames keep the CSS auto-centering fallback.
    const frameWidthPx =
      gridMetrics === null
        ? null
        : gridFrameContentWidthPx(
            placement.items,
            placement.columns,
            gridMetrics.cellPx,
            gridMetrics.gapPx,
          );
    const frameTopPx =
      gridMetrics === null
        ? null
        : gridFrameTopOffsetPx(
            placement.items,
            gridMetrics.stageHeightPx,
            gridMetrics.cellPx,
            gridMetrics.gapPx,
          );
    return (
      <div
        ref={gridStageRef}
        className="vela-grid-stage"
        data-arrange={arrange ? "true" : "false"}
        style={
          {
            "--vd-grid-cell-size": `${gridMetrics?.cellPx ?? 0}px`,
            "--vd-grid-gap": `${gridMetrics?.gapPx ?? 0}px`,
            ...(frameWidthPx === null
              ? {}
              : { "--vd-grid-content-width": `${frameWidthPx}px` }),
            ...(frameTopPx === null ? {} : { "--vd-grid-frame-top": `${frameTopPx}px` }),
          } as CSSProperties
        }
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
      >
        {/*
          The centered FRAME (Helm r2, anchors retuned for layout fill):
          when the spec ceiling caps the cell, the content no longer fills
          the stage — the frame shrink-wraps to the OCCUPIED content width
          (not the stored full column count), centers horizontally, and
          hosts the overlays so the slot lattice, target feedback and drop
          ripples all share the tiles' origin. Vertically the anchored top
          margin (--vd-grid-frame-top, from the measured free space) rests
          the block at a stable upper-third point; auto margins (the CSS
          fallback) still plain-center until the metrics settle, and an
          empty page keeps a full-height frame so the arrange lattice still
          paints.
        */}
        <div
          className="vela-grid-frame"
          data-grid-empty={placement.items.length === 0 ? "true" : undefined}
        >
          {arrange && gridMetrics !== null ? (
            <GridSlotOverlay cellPx={gridMetrics.cellPx} gapPx={gridMetrics.gapPx} />
          ) : null}
          {arrange && gridMetrics !== null && gridFeedbackBoxes !== undefined ? (
            <GridTargetFeedback
              boxes={gridFeedbackBoxes}
              cellPx={gridMetrics.cellPx}
              gapPx={gridMetrics.gapPx}
            />
          ) : null}
          {gridMetrics !== null && snapDropRipples !== undefined && snapDropRipples.length > 0 ? (
            <SnapDropRipples
              ripples={snapDropRipples}
              cellPx={gridMetrics.cellPx}
              gapPx={gridMetrics.gapPx}
            />
          ) : null}
          <div
            className="vela-grid-host"
            style={{
              gridTemplateColumns: `repeat(${placement.columns}, var(--vd-grid-cell-size))`,
            }}
          >
            {placement.items.map((item) => (
              <DesktopItem
                key={item.id}
                item={item}
                workspace={workspace}
                arrange={arrange}
                dragEnabled={dragEnabled}
                metrics={null}
                gridPitchPx={gridMetrics?.pitchPx ?? null}
                gridColumns={placement.columns}
                geometry="grid"
                editingAppearance={appearanceEditingId === item.id}
                selected={selectedIds.has(item.id)}
                resizable={resizableIds.has(item.id)}
                resizeActiveId={resizeActiveId}
                onResizeCommit={onResizeCommit}
                onResizeSessionChange={onResizeSessionChange}
                onResizePreview={onResizePreview}
                onItemSelect={onItemSelect}
                onEntityContextMenu={onEntityContextMenu}
                onOpenFolder={onOpenFolder}
              />
            ))}
          </div>
        </div>
        {/* The drag runway (t63): invisible scroll extent the drag session
            grows while the pointer pushes toward/past the bottom edge, so
            dnd-kit's auto-scroll never runs out of room. */}
        <div className="vela-canvas-runway" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="vela-freeform-stage" data-arrange={arrange ? "true" : "false"}>
      <div
        ref={canvasRef}
        className="vela-canvas"
        data-placement-mode="freeform"
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
      >
        {placement.items.map((item) => (
          <DesktopItem
            key={item.id}
            item={item as CanvasLayoutItem}
            workspace={workspace}
            arrange={arrange}
            dragEnabled={dragEnabled}
            metrics={metrics}
            gridPitchPx={null}
            gridColumns={null}
            geometry="freeform"
            editingAppearance={appearanceEditingId === item.id}
            selected={selectedIds.has(item.id)}
            resizable={resizableIds.has(item.id)}
            resizeActiveId={resizeActiveId}
            onResizeCommit={onResizeCommit}
            onResizeSessionChange={onResizeSessionChange}
            onItemSelect={onItemSelect}
            onEntityContextMenu={onEntityContextMenu}
            onOpenFolder={onOpenFolder}
          />
        ))}
      </div>
      {/* The drag runway (t63) — same contract as the grid stage's. */}
      <div className="vela-canvas-runway" aria-hidden="true" />
    </div>
  );
});

/**
 * Memoized (020-A2 §18): several section layers are mounted at once, and
 * a shell re-render (selection, marquee, dialogs) must not re-render the
 * warm layers' item trees. Works because every caller passes stable
 * callback identities and set references; warm layers additionally get
 * constant empty selection sets.
 */
