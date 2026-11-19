import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_APPEARANCE, resolveBlockVisibility } from "./appearance";

/**
 * task 029 block visibility: the one resolver turning five optional
 * appearance booleans into the shell's show/hide decisions — absent always
 * means SHOWN, so legacy snapshots and default workspaces keep every
 * block, and only an explicit false hides one.
 */
describe("resolveBlockVisibility (task 029)", () => {
  it("shows every block by default (a legacy snapshot never loses a block)", () => {
    expect(resolveBlockVisibility(DEFAULT_WORKSPACE_APPEARANCE)).toEqual({
      helmClock: true,
      helmDate: true,
      commandBar: true,
      dock: true,
      sectionPill: true,
    });
  });

  it("hides only the blocks explicitly turned off", () => {
    const resolved = resolveBlockVisibility({
      ...DEFAULT_WORKSPACE_APPEARANCE,
      showDock: false,
      showHelmDate: false,
    });
    expect(resolved.dock).toBe(false);
    expect(resolved.helmDate).toBe(false);
    expect(resolved.helmClock).toBe(true);
    expect(resolved.commandBar).toBe(true);
    expect(resolved.sectionPill).toBe(true);
  });

  it("treats an explicit true exactly like absent (shown)", () => {
    expect(
      resolveBlockVisibility({ ...DEFAULT_WORKSPACE_APPEARANCE, showDock: true }).dock
    ).toBe(true);
  });
});
