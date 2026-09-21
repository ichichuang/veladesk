import { describe, expect, it } from "vitest";

import {
  canRedoCanvas,
  canUndoCanvas,
  commitCanvas,
  createCanvasHistory,
  reconcileCanvasHistory,
  redoCanvas,
  undoCanvas,
} from "./history";
import { DEFAULT_CANVAS_HISTORY_LIMIT } from "./types";
import type { CanvasHistory, CanvasLayout } from "./types";

function layout(x: number, mode: CanvasLayout["mode"] = "freeform"): CanvasLayout {
  return { version: 1, mode, items: [{ id: "a", rect: { x, y: 0, width: 1000, height: 1000 } }] };
}

const start = layout(0);
const moved = layout(1000);
const movedAgain = layout(2000);

describe("createCanvasHistory", () => {
  it("starts with an empty past and future", () => {
    const history = createCanvasHistory(start);
    expect(history.present).toBe(start);
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
  });

  it("defaults to a limit of fifty", () => {
    expect(createCanvasHistory(start).limit).toBe(DEFAULT_CANVAS_HISTORY_LIMIT);
    expect(DEFAULT_CANVAS_HISTORY_LIMIT).toBe(50);
  });

  it("rejects an invalid limit", () => {
    expect(() => createCanvasHistory(start, 0)).toThrow(RangeError);
    expect(() => createCanvasHistory(start, 2.5)).toThrow(RangeError);
  });
});

describe("commitCanvas", () => {
  it("pushes the present into the past", () => {
    const history = commitCanvas(createCanvasHistory(start), moved);
    expect(history.present).toBe(moved);
    expect(history.past).toEqual([start]);
  });

  it("ignores a canvas equal to the present", () => {
    const history = createCanvasHistory(start);
    expect(commitCanvas(history, layout(0))).toBe(history);
  });

  it("clears the redo branch", () => {
    const undone = undoCanvas(commitCanvas(createCanvasHistory(start), moved));
    expect(canRedoCanvas(undone)).toBe(true);
    expect(commitCanvas(undone, movedAgain).future).toEqual([]);
  });

  it("truncates the past at the limit", () => {
    let history: CanvasHistory = createCanvasHistory(layout(0), 3);
    for (let step = 1; step <= 5; step += 1) {
      history = commitCanvas(history, layout(step * 100));
    }

    expect(history.past).toHaveLength(3);
    expect(history.past[0]).toEqual(layout(200));
    expect(history.present).toEqual(layout(500));
  });
});

describe("undoCanvas and redoCanvas", () => {
  it("returns to the previous canvas", () => {
    const history = undoCanvas(commitCanvas(createCanvasHistory(start), moved));
    expect(history.present).toEqual(start);
    expect(history.future).toEqual([moved]);
  });

  it("is an identity when there is nothing to undo", () => {
    const history = createCanvasHistory(start);
    expect(undoCanvas(history)).toBe(history);
  });

  it("is an identity when there is nothing to redo", () => {
    const history = commitCanvas(createCanvasHistory(start), moved);
    expect(redoCanvas(history)).toBe(history);
  });

  it("round-trips a move and a resize snapshot", () => {
    const resized = layout(1000, "snap");
    const history = commitCanvas(commitCanvas(createCanvasHistory(start), moved), resized);

    const stepBack = undoCanvas(history);
    expect(stepBack.present).toEqual(moved);

    const stepBackAgain = undoCanvas(stepBack);
    expect(stepBackAgain.present).toEqual(start);

    expect(redoCanvas(redoCanvas(stepBackAgain)).present).toEqual(resized);
  });

  it("reports availability", () => {
    const history = commitCanvas(createCanvasHistory(start), moved);
    expect(canUndoCanvas(history)).toBe(true);
    expect(canRedoCanvas(history)).toBe(false);
    expect(canRedoCanvas(undoCanvas(history))).toBe(true);
  });
});

describe("reconcileCanvasHistory", () => {
  it("keeps the branch when the incoming canvas is equal", () => {
    const history = commitCanvas(createCanvasHistory(start), moved);
    const reconciled = reconcileCanvasHistory(history, layout(1000));

    expect(reconciled.present).toEqual(moved);
    expect(reconciled.past).toHaveLength(1);
  });

  it("keeps the branch reference for the identical canvas", () => {
    const history = commitCanvas(createCanvasHistory(start), moved);
    expect(reconcileCanvasHistory(history, moved)).toBe(history);
  });

  it("resets the branch when the canvas diverged", () => {
    const history = commitCanvas(createCanvasHistory(start), moved);
    const reconciled = reconcileCanvasHistory(history, layout(7000));

    expect(reconciled.present).toEqual(layout(7000));
    expect(reconciled.past).toEqual([]);
    expect(reconciled.future).toEqual([]);
    expect(reconciled.limit).toBe(history.limit);
  });
});
