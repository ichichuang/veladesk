import { describe, expect, it } from "vitest";

import { createEmptyWorkspace } from "@veladesk/domain";

import {
  WORKSPACE_SNAPSHOT_VERSION,
  deserializeWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
} from "./serialization";
import { buildRichWorkspaceSnapshot } from "./repository-fixtures";

describe("serializeWorkspaceSnapshot", () => {
  it("produces JSON that parses back to an equal snapshot", () => {
    const snapshot = buildRichWorkspaceSnapshot();

    expect(
      deserializeWorkspaceSnapshot(
        serializeWorkspaceSnapshot(snapshot),
        WORKSPACE_SNAPSHOT_VERSION,
      ),
    ).toEqual(snapshot);
  });

  it("round-trips the empty factory workspace", () => {
    const snapshot = createEmptyWorkspace({
      workspaceId: "workspace-1",
      workspaceName: "My Desk",
      pageId: "page-1",
      pageName: "Home",
      grid: { columns: 12, rows: 8 },
    });

    expect(
      deserializeWorkspaceSnapshot(
        serializeWorkspaceSnapshot(snapshot),
        WORKSPACE_SNAPSHOT_VERSION,
      ),
    ).toEqual(snapshot);
  });
});

describe("deserializeWorkspaceSnapshot version guard", () => {
  it("rejects an unsupported snapshot version", () => {
    const json = serializeWorkspaceSnapshot(buildRichWorkspaceSnapshot());

    expect(() => deserializeWorkspaceSnapshot(json, 0)).toThrow(/unsupported snapshot version/);
    expect(() => deserializeWorkspaceSnapshot(json, 2)).toThrow(/unsupported snapshot version/);
  });

  it("rejects corrupt stored JSON with a decode error", () => {
    expect(() =>
      deserializeWorkspaceSnapshot("{not valid json", WORKSPACE_SNAPSHOT_VERSION),
    ).toThrow(/stored workspace snapshot cannot be decoded/);
  });
});
