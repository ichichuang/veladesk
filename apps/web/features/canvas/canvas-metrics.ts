import { CANVAS_UNITS } from "@veladesk/canvas-engine";

/**
 * Pixel metrics of the rendered canvas content box.
 *
 * The canvas element is positioned exactly on the desktop's usable content
 * box (nav safe area, paddings and dock reserve already subtracted by CSS),
 * so `clientWidth`/`clientHeight` ARE the pixel extent that the logical
 * `0..CANVAS_UNITS` axis maps onto.
 */
export interface CanvasPixelMetrics {
  readonly width: number;
  readonly height: number;
}

function requirePositiveExtent(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number, received: ${value}`);
  }
  return value;
}

/** Measured canvas box → metrics. Throws when the box is not laid out yet. */
export function calculateCanvasPixelMetrics(input: {
  readonly clientWidth: number;
  readonly clientHeight: number;
}): CanvasPixelMetrics {
  return {
    width: requirePositiveExtent("clientWidth", input.clientWidth),
    height: requirePositiveExtent("clientHeight", input.clientHeight),
  };
}

/** Field-by-field equality, so re-measuring cannot cause render loops. */
export function areCanvasPixelMetricsEqual(
  a: CanvasPixelMetrics,
  b: CanvasPixelMetrics,
): boolean {
  return a.width === b.width && a.height === b.height;
}

/**
 * Pixels → logical units on one axis. Continuous: rounding to integers is
 * the geometry engine's job at commit time, never this conversion's.
 */
export function pixelsToUnits(deltaPx: number, extentPx: number): number {
  return (deltaPx / requirePositiveExtent("extentPx", extentPx)) * CANVAS_UNITS;
}

/** Logical units → pixels on one axis. */
export function unitsToPixels(units: number, extentPx: number): number {
  return (units / CANVAS_UNITS) * requirePositiveExtent("extentPx", extentPx);
}
