"use client";

import { useEffect, useState } from "react";

import { areCanvasPixelMetricsEqual, calculateCanvasPixelMetrics } from "./canvas-metrics";
import type { CanvasPixelMetrics } from "./canvas-metrics";

/**
 * Measures the rendered `.vela-canvas` box.
 *
 * CSS already places that box on the desktop's usable content box (nav safe
 * area, paddings, dock reserve), so `clientWidth`/`clientHeight` are exactly
 * the pixel extent of the logical canvas. ResizeObserver and DOM reads stay
 * in this React adapter; the conversion itself is pure.
 *
 * Metrics state is only replaced when a value actually changed, so
 * re-measuring can never cause a render loop.
 */
export function useCanvasMetrics(): {
  canvasRef: (node: HTMLDivElement | null) => void;
  metrics: CanvasPixelMetrics | null;
} {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<CanvasPixelMetrics | null>(null);

  useEffect(() => {
    if (node === null) {
      return;
    }

    const measure = () => {
      try {
        const next = calculateCanvasPixelMetrics({
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
        });
        setMetrics((previous) =>
          previous !== null && areCanvasPixelMetricsEqual(previous, next) ? previous : next,
        );
      } catch {
        // Not laid out yet (hidden section, zero-size window): no metrics
        // rather than wrong ones. Geometry gestures stay disabled.
        setMetrics((previous) => (previous === null ? previous : null));
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { canvasRef: setNode, metrics };
}
