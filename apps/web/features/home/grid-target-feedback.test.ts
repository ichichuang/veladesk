import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";

/**
 * Static contracts of the task 017-B target-slot feedback: while a Grid
 * drag or resize is live, the resolved target cells get one quiet accent
 * overlay. Geometry comes from the same metrics helpers, boxes come from
 * the resolved session geometry (never one component per grid cell), and
 * the layer clears on commit/cancel.
 */
function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

/**
 * P1-ENG-1: the former monolithic desktop-shell.tsx now spans the shell/,
 * scene/ and tile-host/ layers (the root file is a thin re-export). The
 * feedback-wiring contract reads the joined successors — same assertions.
 */
const SHELL_SPLIT_FILES = [
  "./desktop-shell.tsx",
  "./shell/desktop-shell.tsx",
  "./shell/no-pages-fallback.tsx",
  "./shell/shell-context.tsx",
  "./shell/shell-surfaces.tsx",
  "./shell/shell-workspace.tsx",
  "./shell/static-drop-feedback.tsx",
  "./shell/use-appearance-projection.ts",
  "./shell/use-before-change-guard.ts",
  "./shell/use-desktop-menus.ts",
  "./shell/use-desktop-shortcuts.ts",
  "./shell/use-launcher-model.ts",
  "./shell/use-shell-dialogs.ts",
  "./shell/use-shell-settings.ts",
  "./shell/use-shell-theme.ts",
  "./scene/scene-backdrop.tsx",
  "./scene/scene-viewport.tsx",
  "./scene/use-dawn-intro.ts",
  "./scene/use-desktop-scene.ts",
  "./scene/use-pair-coordinator.ts",
  "./scene/use-scene-wallpaper.ts",
  "./scene/use-section-scroll-memory.ts",
  "./tile-host/tile-host-layer.tsx",
  "./tile-host/use-canvas-commits.ts",
  "./tile-host/use-tile-session.ts",
] as const;

const feedback = source("./grid-target-feedback.tsx");
const grid = source("./desktop-grid.tsx");
// P1 hygiene split: the resize preview reporting moved to use-item-resize.ts.
const item = [source("./desktop-item.tsx"), source("./use-item-resize.ts")].join("\n");
const drag = source("../canvas/use-canvas-drag.ts");
const shell = SHELL_SPLIT_FILES.map((file) => source(file)).join("\n");

describe("grid target-slot feedback (task 017-B)", () => {
  it("renders one box per resolved target, never per grid cell", () => {
    expect(feedback).toMatch(/boxes\.map/);
    // No column/row loops building a cell matrix — only the moved items.
    expect(feedback).not.toMatch(/for\s*\(|Array\.from\(/);
  });

  it("derives box geometry from the shared metrics helpers", () => {
    expect(feedback).toContain("gridSpanExtentPx");
    expect(feedback).toMatch(/const pitch = cellPx \+ gapPx/);
    expect(feedback).toMatch(/box\.column \* pitch/);
    expect(feedback).toMatch(/box\.row \* pitch/);
  });

  it("is decorative and outside hit-testing", () => {
    expect(feedback).toContain('className="vela-grid-target-layer"');
    expect(feedback).toContain('aria-hidden="true"');
  });

  it("mounts in the grid stage only during arrange with live boxes", () => {
    expect(grid).toContain("<GridTargetFeedback");
    expect(grid).toContain("gridFeedbackBoxes");
  });

  it("drag sessions report resolved targets and always clear them", () => {
    expect(drag).toContain("onGridTargetChange");
    // Every exit path (cancel, invalidation, no-op, commit) reports null.
    expect((drag.match(/reportTargets\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("resize sessions report live grid previews, deduped, and clear them", () => {
    expect(item).toContain("onResizePreview");
    // Dedup: the report fires only when the integer geometry actually
    // changed — never once per pointermove frame.
    expect(item).toContain("areGridGeometriesEqual");
    expect(item).toMatch(/onResizePreviewRef/);
  });

  it("the shell feeds both feedback sources into the active section", () => {
    expect(shell).toContain("setDragTargetBoxes");
    expect(shell).toContain("setResizeTargetBox");
    expect(shell).toMatch(/dragTargetBoxes/);
    expect(shell).toMatch(/resizeTargetBox/);
  });
});
