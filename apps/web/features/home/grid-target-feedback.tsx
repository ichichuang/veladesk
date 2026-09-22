"use client";

import type { CSSProperties } from "react";

import { gridSpanExtentPx } from "../canvas/square-grid-metrics";
import type { GridItemGeometry } from "../canvas/canvas-resize";

/**
 * Target-slot feedback (task 017-B): while a Grid drag or resize is live,
 * the resolved target cells receive one quiet accent wash so the discrete
 * snap is legible mid-gesture.
 *
 * ONE box per moved item — never one component per grid cell. Geometry is
 * derived from the shared square-grid metrics (never recomputed here) and
 * lands exactly on the target cells: `column * pitch` origin,
 * `gridSpanExtentPx` extent, so a 2×2 target includes its internal gap.
 * Pure decoration: aria-hidden, pointer-transparent, no transitions — the
 * Grid snaps cell-by-cell and so does its feedback.
 */
export interface GridTargetFeedbackProps {
  /** The resolved target boxes (moved items during a drag, the live preview
   * of a resize). Empty renders nothing. */
  readonly boxes: readonly GridItemGeometry[];
  readonly cellPx: number;
  readonly gapPx: number;
}

export function GridTargetFeedback({ boxes, cellPx, gapPx }: GridTargetFeedbackProps) {
  if (boxes.length === 0) {
    return null;
  }
  const pitch = cellPx + gapPx;
  return (
    <div className="vela-grid-target-layer" aria-hidden="true">
      {boxes.map((box, index) => (
        <span
          key={`${box.column}-${box.row}-${box.columnSpan}-${box.rowSpan}-${index}`}
          className="vela-grid-target"
          style={
            {
              left: `${box.column * pitch}px`,
              top: `${box.row * pitch}px`,
              width: `${gridSpanExtentPx(box.columnSpan, cellPx, gapPx)}px`,
              height: `${gridSpanExtentPx(box.rowSpan, cellPx, gapPx)}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
