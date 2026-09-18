import { describe, expect, it } from "vitest";
import type { PageLayout } from "@veladesk/desktop-engine";

import {
  isHandoffCaughtUp,
  reconcileHandoff,
  resolveDisplayLayout,
} from "./layout-handoff";
import type { PendingLayoutHandoff } from "./layout-handoff";

function layoutAt(
  positions: ReadonlyArray<readonly [string, number, number]>
): PageLayout {
  return {
    id: "page-1",
    grid: { columns: 10, rows: 6 },
    items: positions.map(([id, column, row]) => ({
      id,
      position: { column, row },
      span: { columns: 1, rows: 1 },
    })),
  };
}

const authoritative = layoutAt([
  ["app-a", 0, 0],
  ["app-b", 1, 0],
]);
const moved = layoutAt([
  ["app-a", 4, 0],
  ["app-b", 1, 0],
]);

describe("resolveDisplayLayout", () => {
  const handoff: PendingLayoutHandoff = { token: 1, pageId: "page-1", layout: moved };

  it("renders the authoritative layout when nothing is pending", () => {
    expect(resolveDisplayLayout(null, "page-1", authoritative)).toBe(authoritative);
  });

  it("renders the authoritative layout when the handoff targets another page", () => {
    expect(resolveDisplayLayout(handoff, "page-2", authoritative)).toBe(authoritative);
  });

  it("renders the pending layout while the handoff targets the active page", () => {
    expect(resolveDisplayLayout(handoff, "page-1", authoritative)).toBe(moved);
  });
});

describe("isHandoffCaughtUp", () => {
  it("is trivially caught up without a handoff", () => {
    expect(isHandoffCaughtUp(null, authoritative)).toBe(true);
  });

  it("is trivially caught up when the page no longer exists", () => {
    expect(isHandoffCaughtUp({ token: 1, pageId: "page-1", layout: moved }, undefined)).toBe(
      true
    );
  });

  it("is caught up when the authoritative layout is semantically equal", () => {
    // Different object identity, same structure — the staged snapshot
    // decodes into a fresh object tree that equals the pending layout.
    const equalCopy = layoutAt([
      ["app-a", 4, 0],
      ["app-b", 1, 0],
    ]);
    expect(equalCopy).not.toBe(moved);
    expect(isHandoffCaughtUp({ token: 1, pageId: "page-1", layout: moved }, equalCopy)).toBe(
      true
    );
  });

  it("is not caught up while the authoritative layout still differs", () => {
    expect(isHandoffCaughtUp({ token: 1, pageId: "page-1", layout: moved }, authoritative)).toBe(
      false
    );
  });
});

describe("reconcileHandoff", () => {
  const handoff: PendingLayoutHandoff = { token: 7, pageId: "page-1", layout: moved };

  it("keeps nothing when nothing is pending", () => {
    expect(reconcileHandoff(null, { layout: authoritative }, false)).toBeNull();
  });

  it("drops the handoff when its page vanished", () => {
    expect(reconcileHandoff(handoff, undefined, false)).toBeNull();
  });

  it("keeps the handoff while the stage is in flight and layouts differ", () => {
    expect(reconcileHandoff(handoff, { layout: authoritative }, false)).toBe(handoff);
  });

  it("drops the handoff once the authoritative layout caught up", () => {
    expect(reconcileHandoff(handoff, { layout: moved }, false)).toBeNull();
  });

  it("yields to the authoritative layout after the stage settled elsewhere", () => {
    const relocated = layoutAt([
      ["app-a", 2, 2],
      ["app-b", 1, 0],
    ]);
    expect(reconcileHandoff(handoff, { layout: relocated }, true)).toBeNull();
  });
});
