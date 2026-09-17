import type { GridDefinition, GridPosition } from "@veladesk/desktop-engine";

/**
 * Measured pixel geometry of a rendered desktop grid container.
 *
 * Pure numbers only: the React UI layer owns the DOM measurement
 * (ResizeObserver, getBoundingClientRect, getComputedStyle) and feeds the
 * results in here. Fractional pixel values are kept as-is.
 */
export interface GridPixelMetrics {
  readonly width: number;
  readonly height: number;

  readonly columnGap: number;
  readonly rowGap: number;

  readonly cellWidth: number;
  readonly cellHeight: number;
}

/** Raw container measurement input for {@link calculateGridPixelMetrics}. */
export interface GridPixelMeasurementInput {
  readonly width: number;
  readonly height: number;

  readonly columnGap: number;
  readonly rowGap: number;

  readonly grid: GridDefinition;
}

/** Pointer delta in pixels, e.g. between drag start and drag end. */
export interface PixelDelta {
  readonly x: number;
  readonly y: number;
}

/** Arguments of {@link dragDeltaToDesiredPosition}. */
export interface DragDeltaToPositionArgs {
  /** Logical grid position the dragged item started from. */
  readonly start: GridPosition;
  /** Pixel delta accumulated during the free drag. */
  readonly delta: PixelDelta;
  /** Measured pixel geometry of the grid container. */
  readonly metrics: GridPixelMetrics;
}
