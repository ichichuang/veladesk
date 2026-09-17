"use client";

import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { useRef, useState, type CSSProperties } from "react";
import {
  commitLayout,
  createLayoutHistory,
  moveItem,
  redoLayout,
  undoLayout,
  type GridPosition,
  type LayoutHistory,
} from "@veladesk/desktop-engine";
import { dragDeltaToDesiredPosition } from "@veladesk/desktop-interaction";

import { DesktopItem } from "./desktop-item";
import { itemLabels, seedLayout } from "./seed-layout";
import { useGridMetrics } from "./use-grid-metrics";
import "./desktop-lab.css";

type LabMode = "view" | "arrange";

/** The item being dragged, captured at drag start from the current layout. */
interface ActiveDrag {
  itemId: string;
  startPosition: GridPosition;
}

/**
 * Development-only desktop interaction lab.
 *
 * Renders the logical PageLayout from @veladesk/desktop-engine as a CSS grid,
 * lets the user drag items freely (dnd-kit owns the pointer-follow transform),
 * and converts the drop delta to a logical position that is committed once
 * per drag through the engine's nearest-free placement and history.
 */
export function DesktopLab() {
  const [history, setHistory] = useState<LayoutHistory>(() => createLayoutHistory(seedLayout));
  const [mode, setMode] = useState<LabMode>("view");
  const activeDragRef = useRef<ActiveDrag | null>(null);

  const layout = history.present;
  const arrange = mode === "arrange";
  const { gridRef, metrics } = useGridMetrics(layout.grid);

  const handleDragStart = (event: DragStartEvent) => {
    const sourceId = event.operation.source?.id;
    const item =
      sourceId === undefined
        ? undefined
        : layout.items.find((candidate) => candidate.id === sourceId);
    activeDragRef.current =
      item === undefined ? null : { itemId: item.id, startPosition: item.position };
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const active = activeDragRef.current;
    activeDragRef.current = null;

    // Canceled drags (Escape) never change the layout.
    if (event.operation.canceled || active === null || metrics === null) {
      return;
    }

    const delta = {
      x: event.operation.position.current.x - event.operation.position.initial.x,
      y: event.operation.position.current.y - event.operation.position.initial.y,
    };
    const desired = dragDeltaToDesiredPosition({
      start: active.startPosition,
      delta,
      metrics,
    });

    // Collision, clamping and nearest-free resolution all live in the engine.
    const result = moveItem(layout, active.itemId, desired, { placement: "nearest-free" });
    if (result.ok) {
      setHistory((current) => commitLayout(current, result.layout));
    }
  };

  const gridStyle = {
    "--lab-grid-columns": layout.grid.columns,
    "--lab-grid-rows": layout.grid.rows,
    ...(metrics === null
      ? {}
      : {
          "--lab-pitch-x": `${metrics.cellWidth + metrics.columnGap}px`,
          "--lab-pitch-y": `${metrics.cellHeight + metrics.rowGap}px`,
        }),
  } as CSSProperties;

  return (
    <div className="desktop-lab" data-arrange={arrange ? "true" : "false"}>
      <header className="desktop-lab__toolbar">
        <div className="desktop-lab__modes" role="group" aria-label="Desktop mode">
          <button
            type="button"
            className="desktop-lab__button"
            aria-pressed={!arrange}
            onClick={() => setMode("view")}
          >
            View Mode
          </button>
          <button
            type="button"
            className="desktop-lab__button"
            aria-pressed={arrange}
            onClick={() => setMode("arrange")}
          >
            Arrange Mode
          </button>
        </div>
        <p className="desktop-lab__status" data-mode={mode}>
          {arrange ? "Arrange mode — layout unlocked" : "View mode — layout locked"}
        </p>
        <div className="desktop-lab__history">
          <button
            type="button"
            className="desktop-lab__button"
            onClick={() => setHistory((current) => undoLayout(current))}
            disabled={history.past.length === 0}
          >
            Undo
          </button>
          <button
            type="button"
            className="desktop-lab__button"
            onClick={() => setHistory((current) => redoLayout(current))}
            disabled={history.future.length === 0}
          >
            Redo
          </button>
        </div>
      </header>

      <p className="desktop-lab__hint">
        {arrange
          ? "Drag items freely — the grid snaps on release. Escape cancels a drag."
          : "Switch to Arrange Mode to move items."}
      </p>

      <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div ref={gridRef} className="desktop-lab__grid" style={gridStyle}>
          {layout.items.map((item) => (
            <DesktopItem
              key={item.id}
              id={item.id}
              label={itemLabels[item.id] ?? item.id}
              column={item.position.column}
              row={item.position.row}
              columnSpan={item.span.columns}
              rowSpan={item.span.rows}
              draggableEnabled={arrange}
            />
          ))}
        </div>
      </DragDropProvider>
    </div>
  );
}
