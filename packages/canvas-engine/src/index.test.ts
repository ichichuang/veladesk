import { describe, expect, it } from "vitest";

import * as canvasEngine from "./index";

describe("@veladesk/canvas-engine barrel", () => {
  it("exposes the logical canvas extent", () => {
    expect(canvasEngine.CANVAS_UNITS).toBe(10_000);
    expect(canvasEngine.MIN_CANVAS_SIZE).toBe(1);
    expect(canvasEngine.DEFAULT_CANVAS_HISTORY_LIMIT).toBe(50);
  });

  it("exposes the whole public surface as functions", () => {
    const functions = [
      canvasEngine.validateCanvasRect,
      canvasEngine.isValidCanvasRect,
      canvasEngine.canvasRectsEqual,
      canvasEngine.canvasRectFromEdges,
      canvasEngine.clampNumber,
      canvasEngine.isSafeInteger,
      canvasEngine.validateCanvasLayout,
      canvasEngine.areCanvasLayoutsEqual,
      canvasEngine.canvasItemIds,
      canvasEngine.findCanvasItem,
      canvasEngine.replaceCanvasItem,
      canvasEngine.removeCanvasItem,
      canvasEngine.appendCanvasItem,
      canvasEngine.withCanvasMode,
      canvasEngine.withCanvasItems,
      canvasEngine.isCanvasPlacementMode,
      canvasEngine.latticeEdges,
      canvasEngine.canvasLattice,
      canvasEngine.nearestEdgeIndex,
      canvasEngine.snapCanvasRect,
      canvasEngine.canvasRectToSnappedRect,
      canvasEngine.gridPositionToCanvasRect,
      canvasEngine.canvasCellRect,
      canvasEngine.canvasCellSize,
      canvasEngine.isCanvasRectSnapped,
      canvasEngine.translateCanvasItems,
      canvasEngine.clampCanvasTranslation,
      canvasEngine.snapCanvasTranslation,
      canvasEngine.resizeCanvasRect,
      canvasEngine.isCornerHandle,
      canvasEngine.createCanvasHistory,
      canvasEngine.commitCanvas,
      canvasEngine.undoCanvas,
      canvasEngine.redoCanvas,
      canvasEngine.canUndoCanvas,
      canvasEngine.canRedoCanvas,
      canvasEngine.reconcileCanvasHistory,
    ];

    for (const candidate of functions) {
      expect(typeof candidate).toBe("function");
    }
  });
});
