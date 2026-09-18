/**
 * Pure CSS content-box arithmetic for grid measurement.
 *
 * CSS Grid lays out tracks inside the container's content box; padding and
 * border are outside the track area. The DOM measurement hook reads
 * `clientWidth`/`clientHeight` (which include padding, exclude border and
 * scrollbar) plus the computed paddings, and this helper converts them into
 * the content box the tracks actually occupy.
 *
 * Validation mirrors `calculateGridPixelMetrics`: any input that cannot
 * describe a real grid box (non-finite or negative geometry, padding that
 * consumes the client box) throws, so the hook can fall back to "no
 * metrics yet" instead of producing systematically oversized cells.
 */
export interface GridContentSizeInput {
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly paddingLeft: number;
  readonly paddingRight: number;
  readonly paddingTop: number;
  readonly paddingBottom: number;
}

export interface GridContentSize {
  readonly width: number;
  readonly height: number;
}

function requireFiniteNonNegative(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received: ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`${name} must be >= 0, received: ${value}`);
  }
  return value;
}

/** Content box = client box minus paddings; full float precision is kept. */
export function calculateGridContentSize(input: GridContentSizeInput): GridContentSize {
  const clientWidth = requireFiniteNonNegative("clientWidth", input.clientWidth);
  const clientHeight = requireFiniteNonNegative("clientHeight", input.clientHeight);
  const paddingLeft = requireFiniteNonNegative("paddingLeft", input.paddingLeft);
  const paddingRight = requireFiniteNonNegative("paddingRight", input.paddingRight);
  const paddingTop = requireFiniteNonNegative("paddingTop", input.paddingTop);
  const paddingBottom = requireFiniteNonNegative("paddingBottom", input.paddingBottom);

  const width = clientWidth - paddingLeft - paddingRight;
  const height = clientHeight - paddingTop - paddingBottom;
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError(
      `content box must be positive, received width: ${width}, height: ${height}`,
    );
  }
  return { width, height };
}
