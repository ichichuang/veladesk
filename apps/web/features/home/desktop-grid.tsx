"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  CanvasLayout,
  CanvasLayoutV1,
  CanvasRect,
} from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";
import type { EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { DesktopItem } from "./desktop-item";
import { canvasLatticeMarkers } from "../canvas/canvas-style";
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import "./home-shell.css";

interface DesktopCanvasViewProps {
  readonly canvas: CanvasLayout;
  /** The page grid: the snap lattice of this canvas, never a capacity model. */
  readonly grid: GridDefinition;
  readonly workspace: WorkspaceSnapshot;
  /**
   * Whether THIS section runs the arrange session. In the scroll-snap
   * workspace only the active section arranges (task 015) — passing
   * `arrange` already implies the section is active.
   */
  readonly arrange: boolean;
  /**
   * Whether items may start drag sessions at all. Independent of `arrange`:
   * a pending drop handoff briefly disables new drags without pretending the
   * desktop left arrange mode. Inactive sections always render with drags
   * off.
   */
  readonly dragEnabled: boolean;
  /** Canvas pixel metrics — only the active section is measured. */
  readonly metrics: CanvasPixelMetrics | null;
  readonly canvasRef?: ((node: HTMLDivElement | null) => void) | undefined;
  readonly selectedIds: ReadonlySet<EntityId>;
  /**
   * The items that may show the eight resize handles this frame. The shell
   * owns the rule (arrange mode, single selection, an app).
   */
  readonly resizableIds: ReadonlySet<EntityId>;
  /** The app whose resize session or handoff is live, if any. */
  readonly resizeActiveId: EntityId | null;
  readonly onResizeCommit: (entityId: EntityId, rect: CanvasRect) => void;
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
 * One section's desktop canvas.
 *
 * `.vela-canvas` is an absolutely positioned box sitting exactly on the
 * desktop's usable content box (nav safe area, paddings and dock reserve
 * come from CSS), so the logical 0..10000 space maps onto percentage
 * placement — there is no CSS grid anywhere in the production renderer.
 * Arrange interaction (lattice markers, marquee, selection) belongs to the
 * active section only; inactive sections render the same items read-only so
 * scrolling shows the real next section. Pure rendering — drag sessions,
 * selection state and context menus live in the shell.
 */
export function DesktopCanvasView({
  canvas,
  grid,
  workspace,
  arrange,
  dragEnabled,
  metrics,
  canvasRef,
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
  // The lattice is an alignment hint of SNAP sections only: in freeform the
  // canvas has no lattice, so showing dots would lie about the model.
  const v1 = canvas as CanvasLayoutV1;
  const markers = arrange && v1.mode === "snap" ? canvasLatticeMarkers(grid) : [];

  return (
    <div className="vela-desktop__viewport" data-arrange={arrange ? "true" : "false"}>
      <div
        ref={canvasRef}
        className="vela-canvas"
        data-placement-mode={v1.mode}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
      >
        {markers.length > 0 ? (
          <div className="vela-desktop__lattice" aria-hidden="true">
            {markers.map((marker) => (
              <span
                key={marker.key}
                className="vela-desktop__grid-guide"
                style={
                  {
                    left: `${marker.left}%`,
                    top: `${marker.top}%`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        ) : null}
        {v1.items.map((item) => (
          <DesktopItem
            key={item.id}
            item={item}
            workspace={workspace}
            arrange={arrange}
            dragEnabled={dragEnabled}
            metrics={metrics}
            grid={grid}
            placementMode={v1.mode}
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
