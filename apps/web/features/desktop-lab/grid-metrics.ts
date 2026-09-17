import type { GridPixelMetrics } from "@veladesk/desktop-interaction";

/**
 * Field-by-field equality of two grid pixel metrics snapshots.
 *
 * Used by `useGridMetrics` to avoid redundant state updates and by the drag
 * session to detect that the grid resized while a drag was in progress.
 * Local to the desktop lab UI adapter on purpose — it is not part of the
 * public @veladesk/desktop-interaction API.
 */
export function areGridPixelMetricsEqual(a: GridPixelMetrics, b: GridPixelMetrics): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.columnGap === b.columnGap &&
    a.rowGap === b.rowGap &&
    a.cellWidth === b.cellWidth &&
    a.cellHeight === b.cellHeight
  );
}
