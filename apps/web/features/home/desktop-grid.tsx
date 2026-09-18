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
  readonly arrange: boolean;
  /**
   * Whether items may start drag sessions at all. Independent of `arrange`:
   * a pending drop handoff briefly disables new drags without pretending
   * the desktop left arrange mode.
   */
  readonly dragEnabled: boolean;
  readonly metrics: GridPixelMetrics | null;
  readonly gridRef: (node: HTMLDivElement | null) => void;
  readonly selectedIds: ReadonlySet<EntityId>;
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  /** Arrange-mode marquee: pointerdown on the empty grid background. */
  readonly onViewportPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onViewportPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onViewportPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * The desktop viewport: a fixed CSS grid sized by the page layout.
 *
 * Occupies the space between top bar and dock so the body never scrolls.
 * In arrange mode, a guide overlay renders one real CSS-grid cell per
 * logical cell (same template/gap/padding as the viewport, so guide rects
 * are actual track rects) and the empty grid background starts a marquee
 * selection. Pure rendering — drag sessions, selection state and context
 * menus live in the shell.
 */
export function DesktopGridView({
  layout,
  workspace,
  arrange,
  dragEnabled,
  metrics,
  gridRef,
  selectedIds,
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

  const guides = Array.from(
    { length: layout.grid.columns * layout.grid.rows },
    (_, index) => ({
      column: (index % layout.grid.columns) + 1,
      row: Math.floor(index / layout.grid.columns) + 1,
    }),
  );

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
          onItemSelect={onItemSelect}
          onEntityContextMenu={onEntityContextMenu}
          onOpenFolder={onOpenFolder}
        />
      ))}
    </div>
  );
}
