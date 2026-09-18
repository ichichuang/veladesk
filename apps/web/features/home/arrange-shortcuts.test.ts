import { describe, expect, it } from "vitest";

import { resolveArrangeHistoryCommand } from "./arrange-shortcuts";

function chord(
  key: string,
  modifiers: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
    canUndo: true,
    canRedo: true,
  };
}

describe("resolveArrangeHistoryCommand", () => {
  it("resolves Ctrl+Z to undo when undo is available", () => {
    expect(resolveArrangeHistoryCommand(chord("z", { ctrlKey: true }))).toBe("undo");
  });

  it("resolves Cmd+Z to undo when undo is available", () => {
    expect(resolveArrangeHistoryCommand(chord("z", { metaKey: true }))).toBe("undo");
  });

  it("resolves nothing for Ctrl+Z when undo is unavailable", () => {
    expect(
      resolveArrangeHistoryCommand({ ...chord("z", { ctrlKey: true }), canUndo: false }),
    ).toBeNull();
  });

  it("resolves nothing for Cmd+Z when undo is unavailable", () => {
    expect(
      resolveArrangeHistoryCommand({ ...chord("z", { metaKey: true }), canUndo: false }),
    ).toBeNull();
  });

  it("resolves Ctrl+Shift+Z to redo when redo is available", () => {
    expect(
      resolveArrangeHistoryCommand(chord("Z", { ctrlKey: true, shiftKey: true })),
    ).toBe("redo");
  });

  it("resolves Cmd+Shift+Z to redo when redo is available", () => {
    expect(
      resolveArrangeHistoryCommand(chord("Z", { metaKey: true, shiftKey: true })),
    ).toBe("redo");
  });

  it("resolves nothing for redo chords when redo is unavailable", () => {
    expect(
      resolveArrangeHistoryCommand({ ...chord("Z", { ctrlKey: true, shiftKey: true }), canRedo: false }),
    ).toBeNull();
    expect(
      resolveArrangeHistoryCommand({ ...chord("Z", { metaKey: true, shiftKey: true }), canRedo: false }),
    ).toBeNull();
  });

  it("resolves Ctrl+Y to redo when redo is available and nothing when unavailable", () => {
    expect(resolveArrangeHistoryCommand(chord("y", { ctrlKey: true }))).toBe("redo");
    expect(
      resolveArrangeHistoryCommand({ ...chord("y", { ctrlKey: true }), canRedo: false }),
    ).toBeNull();
  });

  it("never resolves Cmd+Y", () => {
    expect(resolveArrangeHistoryCommand(chord("y", { metaKey: true }))).toBeNull();
  });

  it("resolves nothing when Alt is held", () => {
    expect(
      resolveArrangeHistoryCommand(chord("z", { ctrlKey: true, altKey: true })),
    ).toBeNull();
    expect(
      resolveArrangeHistoryCommand(chord("z", { metaKey: true, altKey: true })),
    ).toBeNull();
  });

  it("resolves nothing for plain keys without Ctrl/Cmd", () => {
    expect(resolveArrangeHistoryCommand(chord("z"))).toBeNull();
    expect(resolveArrangeHistoryCommand(chord("Z", { shiftKey: true }))).toBeNull();
    expect(resolveArrangeHistoryCommand(chord("y"))).toBeNull();
  });
});
