import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static contracts of the arrange resize surface (016-C) and the canvas
 * renderer. React component tests are out of scope for this project, so the
 * behaviour that must not silently regress is asserted against the source:
 * a regression here (a grid placement creeping back in, a handle losing its
 * pointer capture, a resize staging on pointermove) is exactly the kind of
 * change that would look fine in a diff and break the interaction.
 */
function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

const item = source("./desktop-item.tsx");
const grid = source("./desktop-grid.tsx");
const shell = source("./desktop-shell.tsx");

describe("desktop item — canvas geometry only", () => {
  it("positions items through canvasRectStyle, never through CSS grid", () => {
    expect(item).toContain("canvasRectStyle(item.rect)");
    expect(item).not.toMatch(/gridColumn|gridRow/);
    expect(grid).not.toMatch(/gridColumn|gridRow|grid-template|display:\s*grid/);
  });

  it("keeps the visual layer separate from the box the pointer hits", () => {
    expect(item).toContain('className="vela-item__body"');
    expect(grid).toContain('className="vela-canvas"');
    // The lattice overlay is arrange-only AND snap-only: a freeform canvas
    // has no lattice, so dots there would misdescribe the model.
    expect(grid).toMatch(/arrange && v1\.mode === "snap"/);
  });

  it("renders the lattice from real cell centers", () => {
    expect(grid).toContain("canvasLatticeMarkers(grid)");
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
    expect(item).toContain("applyRect");
    expect(item).toMatch(/element\.style\.left/);
    // The pointermove handler may only paint: the single commit lives in the
    // pointerup handler, and nothing in this component stages or syncs.
    const pointerMove = item.match(/function handleResizePointerMove[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(pointerMove).toContain("applyRect(");
    expect(pointerMove).not.toContain("onResizeCommit");
    expect(item).not.toMatch(/stageWorkspace|syncCurrent|runtime\./);
    expect(item).toContain("onResizeCommit(entity.id, finalRect)");
  });

  it("leaves the geometry untouched for a no-op gesture", () => {
    expect(item).toContain("isCanvasResizeNoop(");
    expect(item).toMatch(/applyRect\(active\.session\.startRect\)/);
  });

  it("computes the rect through the pure resize math, not inline pointer math", () => {
    expect(item).toContain("canvasResizeRectAt(");
    expect(item).not.toMatch(/clientX\s*-\s*|deltaX\s*=/);
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
    expect(shell).toContain("data-scroll-locked={scrollLocked");
  });
});
