import { CANVAS_UNITS, MIN_CANVAS_SIZE } from "./types";
import type { CanvasRect, CanvasRectProblem } from "./types";

/**
 * Clamp a finite number into `[min, max]`.
 *
 * Negative zero is normalized away: a clamped coordinate must compare and
 * serialize identically to the same rect authored by hand.
 */
export function clampNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return min === 0 ? 0 : min;
  }
  if (value > max) {
    return max === 0 ? 0 : max;
  }
  return value === 0 ? 0 : value;
}

/** Rect fields must be safe integers — never fractions, never `NaN`. */
export function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * Rect-level rules, in a stable order:
 * `not-safe-integer` → `negative-origin` → `size-below-minimum` →
 * `exceeds-canvas`. An empty result means the rect is legal.
 */
export function validateCanvasRect(rect: CanvasRect): readonly CanvasRectProblem[] {
  if (
    !isSafeInteger(rect.x) ||
    !isSafeInteger(rect.y) ||
    !isSafeInteger(rect.width) ||
    !isSafeInteger(rect.height)
  ) {
    return ["not-safe-integer"];
  }

  const problems: CanvasRectProblem[] = [];

  if (rect.x < 0 || rect.y < 0) {
    problems.push("negative-origin");
  }

  if (rect.width < MIN_CANVAS_SIZE || rect.height < MIN_CANVAS_SIZE) {
    problems.push("size-below-minimum");
  }

  if (rect.x + rect.width > CANVAS_UNITS || rect.y + rect.height > CANVAS_UNITS) {
    problems.push("exceeds-canvas");
  }

  return problems;
}

/** True when {@link validateCanvasRect} reports no problem. */
export function isValidCanvasRect(rect: CanvasRect): boolean {
  return validateCanvasRect(rect).length === 0;
}

/** Structural equality of two rects. */
export function canvasRectsEqual(a: CanvasRect, b: CanvasRect): boolean {
  return a === b || (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

/** Build a rect from its four edges. Inputs are expected to be integers. */
export function canvasRectFromEdges(
  left: number,
  top: number,
  right: number,
  bottom: number,
): CanvasRect {
  return { x: left, y: top, width: right - left, height: bottom - top };
}
