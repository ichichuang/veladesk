"use client";

import type { CSSProperties } from "react";
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
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
}

/**
 * The desktop viewport: a fixed CSS grid sized by the page layout.
 *
 * Occupies the space between top bar and dock so the body never scrolls.
 * In arrange mode, faint cell guides appear (pixel pitch from the measured
 * metrics). Pure rendering — drag sessions and context-menu state live in
 * the shell.
 */
export function DesktopGridView({
  layout,
  workspace,
  arrange,
  metrics,
  gridRef,
  onEntityContextMenu,
  onOpenFolder,
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
    >
      {layout.items.map((item) => (
        <DesktopItem
          key={item.id}
          item={item}
          workspace={workspace}
          arrange={arrange}
          metricsAvailable={metrics !== null}
          onEntityContextMenu={onEntityContextMenu}
          onOpenFolder={onOpenFolder}
        />
      ))}
    </div>
  );
}
