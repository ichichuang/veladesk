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
 * In arrange mode, faint cell guides appear (pixel pitch from the measured
 * metrics) and the empty grid background starts a marquee selection.
 * Pure rendering — drag sessions, selection state and context menus live
 * in the shell.
 */
export function DesktopGridView({
  layout,
  workspace,
  arrange,
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
    ...(metrics === null
      ? {}
      : {
          "--vd-pitch-x": `${metrics.cellWidth + metrics.columnGap}px`,
          "--vd-pitch-y": `${metrics.cellHeight + metrics.rowGap}px`,
        }),
  } as CSSProperties;

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
      {layout.items.map((item) => (
        <DesktopItem
          key={item.id}
          item={item}
          workspace={workspace}
          arrange={arrange}
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
