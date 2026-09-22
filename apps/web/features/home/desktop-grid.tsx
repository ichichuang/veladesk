"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CanvasLayoutItem } from "@veladesk/canvas-engine";
import type { PagePlacement, WorkspaceSnapshot, EntityId } from "@veladesk/domain";

import { DesktopItem } from "./desktop-item";
import { GridSlotOverlay } from "./grid-slot-overlay";
import type { ResizeCommitGeometry } from "../canvas/canvas-resize";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import type { SquareGridMetrics } from "../canvas/square-grid-metrics";
import "./home-shell.css";

interface DesktopCanvasViewProps {
  readonly placement: PagePlacement;
  readonly workspace: WorkspaceSnapshot;
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
 * GRID mode is a real CSS Grid: `repeat(columns, minmax(0, 1fr))` columns,
 * `grid-auto-rows: var(--vd-grid-cell-size)` rows and `gap:
 * var(--vd-grid-gap)`; content rows grow without a fixed row count, so the
 * section scroller (the parent) owns vertical scrolling. In Arrange the
 * stage paints the visible square slots as one pointer-transparent SVG
 * pattern (task 017-A) — isolated squares separated by the real gap,
 * never marker nodes, never a pointer target.
 *
 * FREEFORM keeps the continuous percent-space canvas: absolutely positioned
 * rects inside one viewport-height stage, exactly the pre-017 model.
 *
 * Pure rendering — drag sessions, selection state and context menus live in
 * the shell.
 */
export function DesktopCanvasView({
  placement,
  workspace,
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
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
}: DesktopCanvasViewProps) {
  if (placement.mode === "grid") {
    return (
      <div
        ref={gridStageRef}
        className="vela-grid-stage"
        data-arrange={arrange ? "true" : "false"}
        style={
          {
            "--vd-grid-cell-size": `${gridMetrics?.cellPx ?? 0}px`,
            "--vd-grid-gap": `${gridMetrics?.gapPx ?? 0}px`,
          } as CSSProperties
        }
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
      >
        {arrange && gridMetrics !== null ? (
          <GridSlotOverlay cellPx={gridMetrics.cellPx} gapPx={gridMetrics.gapPx} />
        ) : null}
        <div
          className="vela-grid-host"
          style={{ gridTemplateColumns: `repeat(${placement.columns}, minmax(0, 1fr))` }}
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
    </div>
  );
}
