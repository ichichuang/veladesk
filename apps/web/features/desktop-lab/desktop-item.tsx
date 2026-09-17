"use client";

import { useDraggable } from "@dnd-kit/react";

interface DesktopItemProps {
  id: string;
  label: string;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
  /**
   * Whether dragging is enabled. View mode (layout lock) passes `false`:
   * dnd-kit's real `disabled` flag is used — never CSS pointer-events.
   */
  draggableEnabled: boolean;
}

/**
 * One desktop item on the lab grid. A plain <button> keeps native focus and
 * keyboard operation, so dnd-kit's default KeyboardSensor keeps working.
 */
export function DesktopItem({
  id,
  label,
  column,
  row,
  columnSpan,
  rowSpan,
  draggableEnabled,
}: DesktopItemProps) {
  const { ref, isDragging } = useDraggable({ id, disabled: !draggableEnabled });

  return (
    <button
      type="button"
      ref={ref}
      className="desktop-lab__item"
      data-dragging={isDragging ? "true" : undefined}
      data-widget={columnSpan * rowSpan > 1 ? "true" : undefined}
      style={{
        gridColumn: `${column + 1} / span ${columnSpan}`,
        gridRow: `${row + 1} / span ${rowSpan}`,
      }}
    >
      {label}
    </button>
  );
}
