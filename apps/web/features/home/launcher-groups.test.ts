import { describe, expect, it } from "vitest";

import type { LauncherEntry } from "./launcher-types";
import { flattenLauncherGroups, groupLauncherResults } from "./launcher-groups";

/**
 * Task 021-B: launcher result grouping is presentation-only. The ranked
 * list is sliced by kind into fixed-priority groups, ranking order inside
 * a group is preserved, empty groups are omitted, and the flat
 * concatenation is exactly the keyboard index space.
 */

function app(key: string, label: string): LauncherEntry {
  return {
    kind: "app",
    key,
    entityId: key,
    label,
    secondary: [],
    baseOrder: 0,
  };
}

function command(key: string, label: string): LauncherEntry {
  return {
    kind: "command",
    key,
    commandId: "open-settings",
    label,
    secondary: [],
    baseOrder: 0,
  };
}

function folder(key: string, label: string): LauncherEntry {
  return {
    kind: "folder",
    key,
    entityId: key,
    label,
    secondary: [],
    baseOrder: 0,
  };
}

function page(key: string, label: string): LauncherEntry {
  return {
    kind: "page",
    key,
    pageId: key,
    label,
    secondary: [],
    baseOrder: 0,
  };
}

describe("groupLauncherResults", () => {
  it("orders groups by fixed priority: commands, apps, folders, sections", () => {
    const groups = groupLauncherResults([
      page("page:1", "Office"),
      app("app:1", "GitHub"),
      command("command:open-settings", "Settings"),
      folder("folder:1", "Stuff"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["command", "app", "folder", "page"]);
  });

  it("preserves the ranking order inside each group", () => {
    const groups = groupLauncherResults([
      app("app:1", "Beta"),
      app("app:2", "Alpha"),
      app("app:3", "Gamma"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.map((entry) => entry.label)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("omits empty groups — a heading exists only when results exist", () => {
    const groups = groupLauncherResults([command("command:open-settings", "Settings")]);
    expect(groups.map((group) => group.kind)).toEqual(["command"]);
  });

  it("returns no groups for empty results", () => {
    expect(groupLauncherResults([])).toEqual([]);
  });

  it("keeps every entry exactly once (no duplication across groups)", () => {
    const entries = [
      command("command:add-app", "Add App"),
      app("app:1", "GitHub"),
      page("page:1", "Home"),
    ];
    const flat = flattenLauncherGroups(groupLauncherResults(entries));
    expect(flat).toHaveLength(entries.length);
  });
});

describe("flattenLauncherGroups", () => {
  it("concatenates groups in group order — the visual order is the arrow order", () => {
    const groups = groupLauncherResults([
      app("app:1", "GitHub"),
      command("command:add-app", "Add App"),
      page("page:1", "Home"),
    ]);
    expect(flattenLauncherGroups(groups).map((entry) => entry.key)).toEqual([
      "command:add-app",
      "app:1",
      "page:1",
    ]);
  });
});
