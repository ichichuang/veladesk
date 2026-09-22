import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static contracts of the task-017 dual-geometry item surface. React
 * component tests are out of scope for this project, so the behaviour that
 * must not silently regress is asserted against the source: a regression
 * here (freeform items losing percent geometry, grid items losing CSS Grid
 * placement, a handle losing its pointer capture, a resize staging on
 * pointermove) is exactly the kind of change that would look fine in a
 * diff and break the interaction.
 */
function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

const item = source("./desktop-item.tsx");
const grid = source("./desktop-grid.tsx");
const shell = source("./desktop-shell.tsx");
const stage = source("./section-view.tsx");

describe("desktop item — dual geometry", () => {
  it("positions freeform items through canvasRectStyle and grid items through gridPlacementStyle", () => {
    expect(item).toContain("itemStyle(geometry, item)");
    expect(item).toContain('geometry === "grid"');
    expect(grid).toMatch(/gridPlacementStyle|gridColumn/);
    // The CSS Grid host really is a grid with auto rows and a real gap.
    expect(grid).toContain("gridTemplateColumns");
  });

  it("keeps the visual layer separate from the box the pointer hits", () => {
    expect(item).toContain('className="vela-item__body"');
    expect(grid).toContain('className="vela-grid-host"');
    expect(grid).toContain('className="vela-canvas"');
    // The visible square grid is an SVG slot overlay (one square per
    // pattern tile — task 017-A), pointer-transparent and arrange-only.
    expect(grid).toMatch(/\{arrange && gridMetrics !== null \? \(\s*<GridSlotOverlay/);
    expect(grid).not.toContain("vela-grid-lines");
  });

  it("passes grid pitch and columns to items for gesture math", () => {
    expect(grid).toContain("gridPitchPx={gridMetrics?.pitchPx ?? null}");
    expect(grid).toContain("gridColumns={placement.columns}");
  });

  it("previews grid resizes by writing gridColumn/gridRow directly", () => {
    expect(item).toContain("element.style.gridColumn");
    expect(item).toContain("element.style.gridRow");
    expect(item).toContain("element.style.left");
  });
});

describe("desktop item — eight resize handles", () => {
  it("renders the shared handle list, not a hardcoded corner subset", () => {
    expect(item).toContain("CANVAS_RESIZE_HANDLES.map");
    expect(item).not.toMatch(/RESIZE_CORNERS|data-corner/);
    expect(item).toContain('data-handle={handle}');
  });

  it("only apps are resizable, and only one at a time", () => {
    expect(item).toMatch(/entity\.kind === "app" &&\s*\n?\s*resizable/);
    expect(shell).toMatch(/selectedItemIds\.size !== 1/);
    expect(shell).toMatch(/entity !== undefined && entity\.kind === "app"/);
  });

  it("never lets a handle start a drag or a click", () => {
    // Capture phase: dnd-kit's native pointerdown on the button fires before
    // React's bubble handlers, so a bubble-phase stop would be too late.
    expect(item).toContain("onPointerDownCapture={handleResizePointerDown(handle)}");
    expect(item).toMatch(/event\.preventDefault\(\);\s*\n\s*event\.stopPropagation\(\);/);
  });

  it("owns the gesture with pointer capture and cancels cleanly", () => {
    expect(item).toContain("setPointerCapture(event.pointerId)");
    expect(item).toContain("onLostPointerCapture={handleLostPointerCapture}");
    expect(item).toContain("onPointerCancel={handleLostPointerCapture}");
    expect(item).toContain("cancelResize()");
    // Escape must be caught before the shell's own Escape handling consumes it
    // (a live resize owns the key).
    expect(item).toContain('if (event.key === "Escape")');
  });
});

describe("desktop item — resize stays a preview until release", () => {
  it("writes the preview straight to the element, with no React state per frame", () => {
    expect(item).toContain("applyGeometry");
    expect(item).toMatch(/element\.style\.left/);
    // The pointermove handler may only paint: the single commit lives in the
    // pointerup handler, and nothing in this component stages or syncs.
    const pointerMove = item.match(/function handleResizePointerMove[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(pointerMove).toContain("applyGeometry(");
    expect(pointerMove).not.toContain("onResizeCommit");
    expect(item).not.toMatch(/stageWorkspace|syncCurrent|runtime\./);
    expect(item).toContain("onResizeCommit(entity.id, finalGeometry)");
  });

  it("leaves the geometry untouched for a no-op gesture", () => {
    expect(item).toContain("isCanvasResizeNoop(");
    expect(item).toMatch(/applyGeometry\(startGeometryOf\(active\.session\)\)/);
  });

  it("computes the geometry through the pure resize math, not inline pointer math", () => {
    expect(item).toContain("previewGeometryAt(");
    expect(item).toContain("gridResizeGeometryAt(");
    expect(item).toContain("canvasResizeRectAt(");
  });
});

describe("desktop shell — canvas commit path", () => {
  it("commits geometry through the canvas handoff, then the domain op", () => {
    expect(shell).toContain("commitCanvasEdit");
    expect(shell).toContain("replacePageCanvas(");
    expect(shell).not.toContain("replacePageLayout");
  });

  it("records move and resize in the canvas history", () => {
    expect(shell).toContain("commitPageCanvas(");
    expect(shell).toContain("undoPageCanvas(");
    expect(shell).toContain("redoPageCanvas(");
  });

  it("never stages workspace state from a pointermove", () => {
    // Presentation only: the drag hook writes a CSS custom property, and the
    // shell stages nothing until a release callback runs.
    const dragHook = source("../canvas/use-canvas-drag.ts");
    expect(dragHook).not.toMatch(/stageWorkspace|syncCurrent|setState.*canvas/i);
    expect(dragHook).toContain("setProperty(");
  });

  it("locks competing gestures while geometry is in flight", () => {
    expect(shell).toContain("pendingHandoffRef.current !== null || resizeLockRef.current");
    expect(stage).toContain('data-scroll-locked={scrollLocked ? "true" : undefined}');
  });
});
