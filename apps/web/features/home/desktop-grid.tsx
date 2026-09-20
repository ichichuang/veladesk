"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { GridPixelMetrics } from "@veladesk/desktop-interaction";
import type { PageLayout } from "@veladesk/desktop-engine";
import type { EntityId, WorkspaceSnapshot } from "@veladesk/domain";

import { DesktopItem } from "./desktop-item";
import "./home-shell.css";

interface DesktopGridViewProps {
  readonly layout: PageLayout;
  readonly workspace: WorkspaceSnapshot;
  /**
   * Whether THIS grid runs the arrange session (guides + marquee). In the
   * scroll-snap workspace only the active section arranges (task 015) —
   * passing `arrange` already implies the section is active.
   */
  readonly arrange: boolean;
  /**
   * Whether items may start drag sessions at all. Independent of `arrange`:
   * a pending drop handoff briefly disables new drags without pretending
   * the desktop left arrange mode. Inactive sections always render with
   * drags off.
   */
  readonly dragEnabled: boolean;
  readonly metrics: GridPixelMetrics | null;
  /** Only the active section's grid is measured — null elsewhere. */
  readonly gridRef?: ((node: HTMLDivElement | null) => void) | undefined;
  readonly selectedIds: ReadonlySet<EntityId>;
  /**
   * The items that may show the four corner resize handles this frame. The
   * shell owns the rule (arrange mode, single selection, an app) — the grid
   * passes it straight through.
   */
  readonly resizableIds: ReadonlySet<EntityId>;
  /** The app whose resize session or handoff is live, if any. */
  readonly resizeActiveId: EntityId | null;
  readonly onResizeCommit: (entityId: EntityId, scale: number) => void;
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  /** Arrange-mode marquee: pointerdown on the empty grid background. */
  readonly onViewportPointerDown?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onViewportPointerMove?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onViewportPointerUp?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * One section's desktop grid: a fixed CSS grid sized by the page layout.
 *
 * Fills its section (which is exactly one scroll-snap viewport), never
 * scrolls internally. Arrange interaction — guide overlay, marquee,
 * selection — belongs to the active section only; inactive sections render
 * the same items read-only so scrolling shows the real next section.
 * Pure rendering — drag sessions, selection state and context menus live
 * in the shell.
 */
export function DesktopGridView({
  layout,
  workspace,
  arrange,
  dragEnabled,
  metrics,
  gridRef,
  selectedIds,
  resizableIds,
  resizeActiveId,
  onResizeCommit,
  onResizeSessionChange,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
  onViewportPointerDown,
  onViewportPointerMove,
  onViewportPointerUp,
}: DesktopGridViewProps) {
  const gridStyle = {
    "--vd-grid-columns": layout.grid.columns,
    "--vd-grid-rows": layout.grid.rows,
  } as CSSProperties;

  const guides = arrange
    ? Array.from({ length: layout.grid.columns * layout.grid.rows }, (_, index) => ({
        column: (index % layout.grid.columns) + 1,
        row: Math.floor(index / layout.grid.columns) + 1,
      }))
    : [];

  return (
    <div
      ref={gridRef}
      className="vela-desktop__viewport"
      data-arrange={arrange ? "true" : "false"}
      style={gridStyle}
      onPointerDown={onViewportPointerDown}
      onPointerMove={onViewportPointerMove}
      onPointerUp={onViewportPointerUp}
    >
      {arrange ? (
        <div className="vela-desktop__grid-guides" aria-hidden="true">
          {guides.map(({ column, row }) => (
            <span
              key={`${column}-${row}`}
              className="vela-desktop__grid-guide"
              data-grid-column={column}
              data-grid-row={row}
            />
          ))}
        </div>
      ) : null}
      {layout.items.map((item) => (
        <DesktopItem
          key={item.id}
          item={item}
          workspace={workspace}
          arrange={arrange}
          dragEnabled={dragEnabled}
          metricsAvailable={metrics !== null}
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
  );
}
