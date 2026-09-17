import { createEmptyWorkspace } from "@veladesk/domain";
import { describe, expect, it } from "vitest";

import {
  decodeCreateWorkspaceBody,
  decodeExpectedRevision,
  decodeRevisionSegment,
  decodeSaveWorkspaceBody,
  decodeWorkspaceSnapshot,
  parseJsonBody,
} from "./input";

function snapshotJson(overrides: Record<string, unknown> = {}): unknown {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 12, rows: 8 },
  });
  return {
    ...base,
    entities: [
      {
        kind: "app",
        id: "app-1",
        name: "Obsidian",
        url: "obsidian://open?vault=Notes",
        icon: { kind: "generated", text: "OB" },
        openMode: "new-tab",
        tags: ["notes"],
      },
    ],
    ...overrides,
  };
}

describe("parseJsonBody", () => {
  it("parses a valid JSON body", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });

    const result = await parseJsonBody(request);

    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("maps malformed JSON to a 400 invalid-json response", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "{oops",
    });

    const result = await parseJsonBody(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({ error: { code: "invalid-json" } });
      expect(result.response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("decodeWorkspaceSnapshot", () => {
  it("decodes a minimal valid snapshot from the factory shape", () => {
    const decoded = decodeWorkspaceSnapshot(
      createEmptyWorkspace({
        workspaceId: "workspace-1",
        workspaceName: "My Desk",
        pageId: "page-1",
        pageName: "Home",
        grid: { columns: 12, rows: 8 },
      }),
    );

    expect(decoded).toBeDefined();
    expect(decoded?.id).toBe("workspace-1");
  });

  it("accepts a custom protocol snapshot without URL parsing", () => {
    expect(decodeWorkspaceSnapshot(snapshotJson())).toBeDefined();
  });

  it("ignores unknown extra properties", () => {
    expect(decodeWorkspaceSnapshot(snapshotJson({ futureField: { nested: true } }))).toBeDefined();
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "workspace"],
    ["a number", 42],
  ])("rejects a body that is %s", (_label, value) => {
    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it.each([
    ["missing id", (value: Record<string, unknown>) => delete value.id],
    ["non-string id", (value: Record<string, unknown>) => (value.id = 7)],
    ["missing name", (value: Record<string, unknown>) => delete value.name],
    ["non-string name", (value: Record<string, unknown>) => (value.name = null)],
    ["pages not an array", (value: Record<string, unknown>) => (value.pages = {})],
    ["entities not an array", (value: Record<string, unknown>) => (value.entities = "x")],
    ["categories not an array", (value: Record<string, unknown>) => (value.categories = null)],
    ["dock not a record", (value: Record<string, unknown>) => (value.dock = [])],
    ["dock items not strings", (value: Record<string, unknown>) => (value.dock = { items: [1] })],
    [
      "preferences layoutLocked not boolean",
      (value: Record<string, unknown>) => (value.preferences = { defaultPageId: "p", layoutLocked: "yes" }),
    ],
    [
      "preferences defaultPageId missing",
      (value: Record<string, unknown>) => (value.preferences = { layoutLocked: true }),
    ],
  ])("rejects a snapshot with %s", (_label, mutate) => {
    const value = snapshotJson() as Record<string, unknown>;
    mutate(value);

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a bad nested page", () => {
    const value = snapshotJson({
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: "12", rows: 8 },
            items: [],
          },
        },
      ],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a bad layout item", () => {
    const value = snapshotJson({
      pages: [
        {
          id: "page-1",
          name: "Home",
          layout: {
            id: "page-1",
            grid: { columns: 12, rows: 8 },
            items: [
              {
                id: "app-1",
                position: { column: 0, row: 0 },
                span: { columns: 1, rows: "1" },
              },
            ],
          },
        },
      ],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects an entity of unknown kind", () => {
    const value = snapshotJson({
      entities: [{ kind: "plugin", id: "p-1", name: "Mystery" }],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a bad app icon", () => {
    const value = snapshotJson({
      entities: [
        {
          kind: "app",
          id: "app-1",
          name: "Wiki",
          url: "https://wiki.example.com",
          icon: { kind: "iconify" },
          openMode: "new-tab",
          tags: [],
        },
      ],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects an app with an unknown openMode", () => {
    const value = snapshotJson({
      entities: [
        {
          kind: "app",
          id: "app-1",
          name: "Wiki",
          url: "https://wiki.example.com",
          icon: { kind: "favicon" },
          openMode: "background",
          tags: [],
        },
      ],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it.each([
    ["a string", "docs"],
    ["an array of non-strings", [1]],
  ])("rejects app tags that are %s", (_label, tags) => {
    const value = snapshotJson({
      entities: [
        {
          kind: "app",
          id: "app-1",
          name: "Wiki",
          url: "https://wiki.example.com",
          icon: { kind: "favicon" },
          openMode: "new-tab",
          tags,
        },
      ],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a widget whose config is an array", () => {
    const value = snapshotJson({
      entities: [
        {
          kind: "widget",
          id: "widget-1",
          widgetType: "builtin.clock",
          config: [],
        },
      ],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("rejects a widget whose config contains a non-JSON value", () => {
    const value = snapshotJson() as Record<string, unknown>;
    value.entities = [
      {
        kind: "widget",
        id: "widget-1",
        widgetType: "builtin.clock",
        config: { timezone: undefined },
      },
    ];

    expect(decodeWorkspaceSnapshot(value)).toBeUndefined();
  });

  it("accepts a folder and a widget with full valid shapes", () => {
    const value = snapshotJson({
      entities: [
        {
          kind: "folder",
          id: "folder-1",
          name: "Games",
          children: ["app-1"],
        },
        {
          kind: "widget",
          id: "widget-1",
          widgetType: "builtin.clock",
          title: "Clock",
          config: { timezone: "UTC", scale: { zoom: 1.5 } },
        },
      ],
    });

    expect(decodeWorkspaceSnapshot(value)).toBeDefined();
  });
});

describe("decodeCreateWorkspaceBody", () => {
  it("decodes { snapshot }", () => {
    const decoded = decodeCreateWorkspaceBody({ snapshot: snapshotJson() });

    expect(decoded?.id).toBe("workspace-1");
  });

  it.each([
    ["a non-record", "snapshot"],
    ["a missing snapshot field", {}],
    ["a non-snapshot snapshot field", { snapshot: { id: 1 } }],
  ])("rejects %s", (_label, value) => {
    expect(decodeCreateWorkspaceBody(value)).toBeUndefined();
  });
});

describe("decodeSaveWorkspaceBody", () => {
  it("decodes { snapshot, expectedRevision } and keeps expectedRevision raw", () => {
    const decoded = decodeSaveWorkspaceBody({
      snapshot: snapshotJson(),
      expectedRevision: 3,
    });

    expect(decoded?.snapshot.id).toBe("workspace-1");
    expect(decoded?.expectedRevision).toBe(3);
  });

  it("passes a missing expectedRevision through as undefined for later mapping", () => {
    const decoded = decodeSaveWorkspaceBody({ snapshot: snapshotJson() });

    expect(decoded?.expectedRevision).toBeUndefined();
  });

  it("rejects a body whose snapshot shape is invalid", () => {
    expect(decodeSaveWorkspaceBody({ snapshot: {}, expectedRevision: 1 })).toBeUndefined();
  });
});

describe("decodeExpectedRevision", () => {
  it.each([
    [1, 1],
    [100, 100],
  ])("accepts %s", (input, expected) => {
    expect(decodeExpectedRevision(input)).toBe(expected);
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    ["1.5", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ['"1"', "1"],
    ["undefined", undefined],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    expect(decodeExpectedRevision(input)).toBeUndefined();
  });
});

describe("decodeRevisionSegment", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    ["100", 100],
  ])("accepts the canonical segment %s", (segment, expected) => {
    expect(decodeRevisionSegment(segment)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "01", "abc", "", "1 "])(
    "rejects the segment %s",
    (segment) => {
      expect(decodeRevisionSegment(segment)).toBeUndefined();
    },
  );
});
