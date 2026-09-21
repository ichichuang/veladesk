import type { CSSProperties } from "react";
import { CANVAS_UNITS, canvasCellRect } from "@veladesk/canvas-engine";
import type { CanvasRect } from "@veladesk/canvas-engine";
import type { GridDefinition } from "@veladesk/desktop-engine";

/**
 * Percentage geometry of a canvas rect.
 *
 * Every canvas item is absolutely positioned inside `.vela-canvas`, whose
 * box IS the logical canvas, so a percentage is the only conversion needed —
 * and it lives here, never scattered across components.
 */
export interface CanvasRectPercentages {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function canvasRectPercentages(rect: CanvasRect): CanvasRectPercentages {
  const toPercent = (units: number): number => (units / CANVAS_UNITS) * 100;
  return {
    left: toPercent(rect.x),
    top: toPercent(rect.y),
    width: toPercent(rect.width),
    height: toPercent(rect.height),
  };
}

/** Inline style that places one canvas item in percent space. */
export function canvasRectStyle(rect: CanvasRect): CSSProperties {
  const percentages = canvasRectPercentages(rect);
  return {
    position: "absolute",
    left: `${percentages.left}%`,
    top: `${percentages.top}%`,
    width: `${percentages.width}%`,
    height: `${percentages.height}%`,
  };
}

/** One snap-lattice marker: the center of a cell, in percent space. */
export interface CanvasLatticeMarker {
  readonly key: string;
  readonly left: number;
  readonly top: number;
}

/**
 * Lattice markers for the arrange overlay — one per cell, placed at the
 * cell center computed from the SAME edge rounding the snap engine uses, so
 * a marker can never disagree with where an item actually snaps.
 */
export function canvasLatticeMarkers(grid: GridDefinition): readonly CanvasLatticeMarker[] {
  const markers: CanvasLatticeMarker[] = [];

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const cell = canvasCellRect(grid, column, row);
      const center = canvasRectPercentages({
        x: cell.x + Math.floor(cell.width / 2),
        y: cell.y + Math.floor(cell.height / 2),
        width: 0,
        height: 0,
      });
      markers.push({ key: `${column}-${row}`, left: center.left, top: center.top });
    }
  }

  return markers;
}
