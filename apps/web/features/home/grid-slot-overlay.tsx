"use client";

import { useId } from "react";

/**
 * The visible task-017A Grid: isolated square slots, never graph paper.
 *
 * One SVG whose repeating pattern tile spans a full pitch (cell + gap) and
 * contains exactly ONE stroked square. The tile's remaining area is
 * transparent, so the persisted `gridGapPx` becomes real blank space
 * between neighbouring slots — a 2×2 item covers four squares plus the
 * internal gap on each axis, exactly like the CSS Grid tracks beneath.
 *
 * Geometry is consumed, never computed: `cellPx`/`gapPx` come from
 * `calculateSquareGridMetrics` in the shared metrics module. The overlay
 * is `position: absolute; inset: 0` over the grid stage (the CSS class),
 * pointer-transparent, decorative only.
 */
export interface GridSlotOverlayProps {
  /** Side of one square cell in CSS pixels (measured, fractional allowed). */
  readonly cellPx: number;
  /** The persisted gap: literal blank distance between neighbouring slots. */
  readonly gapPx: number;
}

export function GridSlotOverlay({ cellPx, gapPx }: GridSlotOverlayProps) {
  // Entering/exiting sections can mount two overlays at once; each needs
  // its own pattern or the second svg would paint the first one's geometry.
  const patternId = `vela-grid-slots-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const pitchPx = cellPx + gapPx;

  return (
    <svg className="vela-grid-slots" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={patternId} patternUnits="userSpaceOnUse" width={pitchPx} height={pitchPx}>
          <rect width={cellPx} height={cellPx} fill="none" stroke="var(--vd-grid-line)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
