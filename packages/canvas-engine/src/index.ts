/**
 * Public API of @veladesk/canvas-engine.
 *
 * Explicit named exports only — no `export *`. The package is pure
 * TypeScript: React, DOM, IndexedDB, Node fs and Next must never be imported
 * from here.
 */

export {
  CANVAS_UNITS,
  DEFAULT_CANVAS_HISTORY_LIMIT,
  MIN_CANVAS_SIZE,
} from "./types";
export type {
  CanvasHistory,
  CanvasLattice,
  CanvasLayout,
  CanvasLayoutItem,
  CanvasLayoutV1,
  CanvasPlacementMode,
  CanvasRect,
  CanvasRectProblem,
  CanvasResizeArgs,
  CanvasResizeHandle,
  CanvasTranslation,
  CanvasValidationIssue,
  FreeformCanvasLayoutV2,
  GridCanvasItem,
  GridCanvasLayoutV2,
  GridItemProblem,
  PagePlacementMode,
  RectCanvasLayout,
} from "./types";

export {
  canvasRectFromEdges,
  canvasRectsEqual,
  clampNumber,
  isSafeInteger,
  isValidCanvasRect,
  validateCanvasRect,
} from "./rect";

export {
  canvasCellRect,
  canvasCellSize,
  canvasLattice,
  canvasRectToSnappedRect,
  gridPositionToCanvasRect,
  isCanvasRectSnapped,
  latticeEdges,
  nearestEdgeIndex,
  snapCanvasRect,
} from "./lattice";

export {
  appendCanvasItem,
  areCanvasLayoutsEqual,
  canvasItemIds,
  findCanvasItem,
  isCanvasPlacementMode,
  removeCanvasItem,
  replaceCanvasItem,
  validateCanvasLayout,
  withCanvasItems,
  withCanvasMode,
} from "./layout";

export {
  appendGridItem,
  canConvertGridToFreeform,
  canvasRectToGridGeometry,
  clampGridTranslation,
  firstFreeGridPlacement,
  findGridItem,
  freeformLayoutFromV1,
  gridItemToCanvasRect,
  gridItemsEqual,
  gridLayoutFromV1,
  gridLayoutToFreeform,
  isFreeformCanvasLayout,
  isGridCanvasLayout,
  maxOccupiedRow,
  replaceGridItem,
  resizeGridItem,
  translateGridItems,
  validateGridCanvasItems,
} from "./grid";

export {
  clampCanvasTranslation,
  snapCanvasTranslation,
  translateCanvasItems,
} from "./translate";

export { isCornerHandle, resizeCanvasRect } from "./resize";

export {
  canRedoCanvas,
  canUndoCanvas,
  commitCanvas,
  createCanvasHistory,
  reconcileCanvasHistory,
  redoCanvas,
  undoCanvas,
} from "./history";
