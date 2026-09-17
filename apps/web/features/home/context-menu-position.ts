/**
 * Pure context-menu viewport clamping.
 *
 * The menu is rendered first and measured, then its real size is clamped
 * here so the surface never leaves the viewport — including the degenerate
 * "menu bigger than the viewport" case, which pins to the margin.
 */
export interface ContextMenuPositionArgs {
  readonly x: number;
  readonly y: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly menuWidth: number;
  readonly menuHeight: number;
  readonly margin?: number;
}

/** A viewport-safe top-left position for the menu. */
export function clampContextMenuPosition({
  x,
  y,
  viewportWidth,
  viewportHeight,
  menuWidth,
  menuHeight,
  margin = 8,
}: ContextMenuPositionArgs): { x: number; y: number } {
  const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
  const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}
