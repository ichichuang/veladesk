"use client";

import { useEffect, useState } from "react";

import {
  calculateSquareGridMetrics,
  withMeasuredStageHeight,
} from "./square-grid-metrics";
import type { SquareGridMetrics } from "./square-grid-metrics";

/**
 * Measures the rendered `.vela-grid-stage` box and derives the square-cell
 * metrics from its width.
 *
 * The stage fills the section scroller's content width, and the scroller
 * keeps a stable scrollbar gutter, so `clientWidth` does not change when a
 * scrollbar appears. `maxCellPx` caps how large the derived cell may grow —
 * a plain number, or a function OF THE MEASURED WIDTH (the Helm r3
 * viewport-fluid ceiling; the stage width is layout-fixed, so deriving the
 * cap inside the measurement converges without extra state). On wide
 * stages the capped content centers inside the stage instead of filling
 * it. The stage HEIGHT rides along (layout-fill): the frame's vertical
 * anchor derives from the free space it leaves. Metrics state is only
 * replaced when a value actually changed, so re-measuring can never cause
 * a render loop. The column count is persistent layout structure — it is
 * NEVER recomputed from the width.
 */
export function useSquareGridMetrics(
  columns: number,
  gapPx: number,
  maxCellPx?: number | ((availableWidthPx: number) => number),
): {
  stageRef: (node: HTMLDivElement | null) => void;
  metrics: SquareGridMetrics | null;
} {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<SquareGridMetrics | null>(null);

  useEffect(() => {
    if (node === null) {
      return;
    }

    const measure = () => {
      const ceiling =
        typeof maxCellPx === "function" ? maxCellPx(node.clientWidth) : maxCellPx;
      const next = calculateSquareGridMetrics({
        availableWidthPx: node.clientWidth,
        columns,
        gapPx,
        ...(ceiling === undefined ? {} : { maxCellPx: ceiling }),
      });
      const measured = next === null ? null : withMeasuredStageHeight(next, node.clientHeight);
      setMetrics((previous) =>
        previous !== null &&
        measured !== null &&
        previous.cellPx === measured.cellPx &&
        previous.pitchPx === measured.pitchPx &&
        previous.contentWidthPx === measured.contentWidthPx &&
        previous.stageHeightPx === measured.stageHeightPx
          ? previous
          : measured,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, columns, gapPx, maxCellPx]);

  return { stageRef: setNode, metrics };
}
