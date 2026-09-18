"use client";

import { useEffect, useState } from "react";
import type { GridDefinition } from "@veladesk/desktop-engine";
import {
  calculateGridPixelMetrics,
  type GridPixelMetrics,
} from "@veladesk/desktop-interaction";

import { calculateGridContentSize } from "./grid-box";
import { areGridPixelMetricsEqual } from "./grid-metrics";

/**
 * Measures the rendered grid container and derives grid pixel metrics.
 *
 * ResizeObserver and DOM reads stay in this React UI adapter; the conversion
 * itself is pure (`calculateGridContentSize` +
 * `calculateGridPixelMetrics`). CSS Grid tracks live in the container's
 * content box, so the measurement uses clientWidth/clientHeight minus the
 * computed paddings — never the whole bounding rect, which would
 * systematically inflate every cell. Metrics state is only replaced when a
 * value actually changed, so resize observation cannot cause render loops.
 *
 * Logical layout is never touched here — resizing only affects pixel metrics.
 *
 * Shared by the production desktop shell and the desktop interaction lab.
 */
export function useGridMetrics(grid: GridDefinition): {
  gridRef: (node: HTMLDivElement | null) => void;
  metrics: GridPixelMetrics | null;
} {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<GridPixelMetrics | null>(null);

  useEffect(() => {
    if (node === null) {
      return;
    }

    const measure = () => {
      const style = window.getComputedStyle(node);
      try {
        const content = calculateGridContentSize({
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
          paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
          paddingRight: Number.parseFloat(style.paddingRight) || 0,
          paddingTop: Number.parseFloat(style.paddingTop) || 0,
          paddingBottom: Number.parseFloat(style.paddingBottom) || 0,
        });
        const next = calculateGridPixelMetrics({
          width: content.width,
          height: content.height,
          columnGap: Number.parseFloat(style.columnGap) || 0,
          rowGap: Number.parseFloat(style.rowGap) || 0,
          grid,
        });
        setMetrics((previous) =>
          previous !== null && areGridPixelMetricsEqual(previous, next) ? previous : next,
        );
      } catch {
        // Container not laid out (or too small) yet: no metrics rather than
        // wrong ones. Drags are disabled while metrics are unavailable.
        setMetrics((previous) => (previous === null ? previous : null));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, grid]);

  return { gridRef: setNode, metrics };
}
