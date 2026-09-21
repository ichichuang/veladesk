"use client";

import { useEffect, useState } from "react";

import {
  calculateSquareGridMetrics,
} from "./square-grid-metrics";
import type { SquareGridMetrics } from "./square-grid-metrics";

/**
 * Measures the rendered `.vela-grid-stage` box and derives the square-cell
 * metrics from its width.
 *
 * The stage fills the section scroller's content width, and the scroller
 * keeps a stable scrollbar gutter, so `clientWidth` does not change when a
 * scrollbar appears. Metrics state is only replaced when a value actually
 * changed, so re-measuring can never cause a render loop. The column count
 * is persistent layout structure — it is NEVER recomputed from the width.
 */
export function useSquareGridMetrics(columns: number, gapPx: number): {
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
      const next = calculateSquareGridMetrics({
        availableWidthPx: node.clientWidth,
        columns,
        gapPx,
      });
      setMetrics((previous) =>
        previous !== null &&
        next !== null &&
        previous.cellPx === next.cellPx &&
        previous.pitchPx === next.pitchPx &&
        previous.contentWidthPx === next.contentWidthPx
          ? previous
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, columns, gapPx]);

  return { stageRef: setNode, metrics };
}
