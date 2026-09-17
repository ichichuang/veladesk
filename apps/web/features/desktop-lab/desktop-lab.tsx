"use client";

import { DragDropProvider } from "@dnd-kit/react";
import { useState, type CSSProperties } from "react";
import {
  commitLayout,
  createLayoutHistory,
  redoLayout,
  undoLayout,
  type LayoutHistory,
} from "@veladesk/desktop-engine";

import { useAtomicGridDrag } from "../desktop-grid/use-atomic-grid-drag";
import { useGridMetrics } from "../desktop-grid/use-grid-metrics";
import { DesktopItem } from "./desktop-item";
import { itemLabels, seedLayout } from "./seed-layout";
import "./desktop-lab.css";

type LabMode = "view" | "arrange";

/**
 * Development-only desktop interaction lab.
 *
 * Renders the logical PageLayout from @veladesk/desktop-engine as a CSS grid,
 * lets the user drag items freely (dnd-kit owns the pointer-follow transform),
 * and commits each drag exactly once as an atomic session via the shared
 * useAtomicGridDrag contract (production desktop + lab).
 */
export function DesktopLab() {
  const [history, setHistory] = useState<LayoutHistory>(() => createLayoutHistory(seedLayout));
  const [mode, setMode] = useState<LabMode>("view");

  const layout = history.present;
  const arrange = mode === "arrange";
  const { gridRef, metrics } = useGridMetrics(layout.grid);
  const { dragging, handleDragStart, handleDragEnd } = useAtomicGridDrag({
    layout,
    metrics,
    onCommit: (moved, layoutAtStart) => {
      setHistory((current) => {
        // Stale-drop guard: only commit if the present layout is still the
        // exact snapshot this drag started from. This is an interaction-
        // session guard, not a persistence revision protocol.
        if (current.present !== layoutAtStart) {
          return current;
        }
        return commitLayout(current, moved);
      });
    },
  });

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
            disabled={dragging}
          >
            View Mode
          </button>
          <button
            type="button"
            className="desktop-lab__button"
            aria-pressed={arrange}
            onClick={() => setMode("arrange")}
            disabled={dragging}
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
            disabled={dragging || history.past.length === 0}
          >
            Undo
          </button>
          <button
            type="button"
            className="desktop-lab__button"
            onClick={() => setHistory((current) => redoLayout(current))}
            disabled={dragging || history.future.length === 0}
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
              draggableEnabled={arrange && metrics !== null}
            />
          ))}
        </div>
      </DragDropProvider>
    </div>
  );
}
