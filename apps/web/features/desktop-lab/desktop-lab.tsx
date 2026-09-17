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
  type PageLayout,
} from "@veladesk/desktop-engine";
import {
  dragDeltaToDesiredPosition,
  type GridPixelMetrics,
} from "@veladesk/desktop-interaction";

import { DesktopItem } from "./desktop-item";
import { areGridPixelMetricsEqual } from "./grid-metrics";
import { itemLabels, seedLayout } from "./seed-layout";
import { useGridMetrics } from "./use-grid-metrics";
import "./desktop-lab.css";

type LabMode = "view" | "arrange";

/**
 * One drag interaction, snapshotted at drag start.
 *
 * References only — the engine keeps layouts immutable and pixel metrics are
 * replaced (never mutated) on re-measure, so the captured references stay a
 * faithful picture of the moment the drag began. The drop is computed against
 * exactly this snapshot, never against a later render.
 */
interface ActiveDrag {
  readonly itemId: string;
  readonly startPosition: GridPosition;
  readonly layoutAtStart: PageLayout;
  readonly metricsAtStart: GridPixelMetrics;
}

/**
 * Development-only desktop interaction lab.
 *
 * Renders the logical PageLayout from @veladesk/desktop-engine as a CSS grid,
 * lets the user drag items freely (dnd-kit owns the pointer-follow transform),
 * and commits each drag exactly once as an atomic session: the layout and
 * pixel-metrics snapshots captured at drag start are the only inputs, and the
 * commit is dropped if either the layout or the grid geometry changed mid-drag.
 */
export function DesktopLab() {
  const [history, setHistory] = useState<LayoutHistory>(() => createLayoutHistory(seedLayout));
  const [mode, setMode] = useState<LabMode>("view");
  const [dragging, setDragging] = useState(false);
  const activeDragRef = useRef<ActiveDrag | null>(null);

  const layout = history.present;
  const arrange = mode === "arrange";
  const { gridRef, metrics } = useGridMetrics(layout.grid);

  const handleDragStart = (event: DragStartEvent) => {
    // No measurement yet → no session; drags are also disabled at the source,
    // this guard keeps the session contract true regardless.
    if (metrics === null) {
      return;
    }
    const sourceId = event.operation.source?.id;
    const item =
      sourceId === undefined
        ? undefined
        : layout.items.find((candidate) => candidate.id === sourceId);
    if (item === undefined) {
      return;
    }

    activeDragRef.current = {
      itemId: item.id,
      startPosition: item.position,
      layoutAtStart: layout,
      metricsAtStart: metrics,
    };
    setDragging(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    // Session cleanup happens on every path — normal drop, cancel, resize
    // invalidation, stale layout, engine refusal — before any early return.
    const active = activeDragRef.current;
    activeDragRef.current = null;
    setDragging(false);

    if (event.canceled || active === null) {
      return;
    }

    // Grid geometry changed mid-drag: the pixel space the user aimed at no
    // longer exists, so the commit is invalidated. The item visually returns
    // to its pre-drag cell; the user simply drags again under the new size.
    if (metrics === null || !areGridPixelMetricsEqual(metrics, active.metricsAtStart)) {
      return;
    }

    const delta = {
      x: event.operation.position.current.x - event.operation.position.initial.x,
      y: event.operation.position.current.y - event.operation.position.initial.y,
    };
    const desired = dragDeltaToDesiredPosition({
      start: active.startPosition,
      delta,
      metrics: active.metricsAtStart,
    });

    // Collision, clamping and nearest-free resolution all live in the engine,
    // computed against the drag-start layout snapshot.
    const result = moveItem(active.layoutAtStart, active.itemId, desired, {
      placement: "nearest-free",
    });
    if (result.ok) {
      setHistory((current) => {
        // Stale-drop guard: only commit if the present layout is still the
        // exact snapshot this drag started from. This is an interaction-
        // session guard, not a persistence revision protocol.
        if (current.present !== active.layoutAtStart) {
          return current;
        }
        return commitLayout(current, result.layout);
      });
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
