import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createEmptyWorkspace } from "@veladesk/domain";
import type { AppShortcut, Folder, WorkspaceSnapshot } from "@veladesk/domain";

import { resolveDockEntities } from "./dock-model";

/**
 * Task 015 dock contract: the dock is pinned entities ONLY. No utility
 * cluster (create / mode toggle), no separator, and — most importantly —
 * an empty pin list means the dock does not exist in the DOM at all.
 */

function app(id: string, name = id): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: "https://example.com/",
    icon: { kind: "generated", text: name.slice(0, 2).toUpperCase() },
    openMode: "new-tab",
    tags: [],
  };
}

function folder(id: string, name: string): Folder {
  return { kind: "folder", id, name, children: [] };
}

function workspaceWithDock(...entityIds: readonly string[]): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 3, rows: 3 },
  });
  return {
    ...base,
    entities: [app("app-a"), folder("folder-1", "Stuff")],
    dock: { items: [...entityIds] },
  };
}

describe("resolveDockEntities", () => {
  it("returns NOTHING for an empty dock — the zero-entity model behind the null render", () => {
    expect(resolveDockEntities(workspaceWithDock())).toEqual([]);
  });

  it("returns exactly the resolvable pins, in dock order", () => {
    const entities = resolveDockEntities(workspaceWithDock("app-a", "folder-1"));
    expect(entities.map((entity) => entity.id)).toEqual(["app-a", "folder-1"]);
  });

  it("skips dangling references and widgets without reordering", () => {
    const base = workspaceWithDock("app-a");
    const withWidget: WorkspaceSnapshot = {
      ...base,
      entities: [...base.entities, { kind: "widget", id: "widget-1", widgetType: "builtin.clock", config: {} }],
      dock: { items: ["app-a", "widget-1", "ghost", "folder-1"] },
    };
    const entities = resolveDockEntities(withWidget);
    expect(entities.map((entity) => entity.id)).toEqual(["app-a", "folder-1"]);
  });
});

describe("dock.tsx static contract", () => {
  const source = readFileSync(fileURLToPath(new URL("./dock.tsx", import.meta.url)), "utf8");

  it("renders NO shell at all when the dock has zero entities", () => {
    expect(source).toMatch(/if\s*\(dockEntities\.length === 0\)\s*\{\s*return null;\s*\}/);
  });

  it("carries no utility controls: no create button, no mode toggle, no separator", () => {
    expect(source).not.toMatch(/onToggleMode/);
    expect(source).not.toMatch(/onCreateMenu/);
    expect(source).not.toMatch(/vela-dock__utility/);
    expect(source).not.toMatch(/vela-dock__separator/);
    expect(source).not.toMatch(/dock\.create/);
  });
});

describe("dock.tsx tooltip contract (task 021-C)", () => {
  const source = readFileSync(fileURLToPath(new URL("./dock.tsx", import.meta.url)), "utf8");

  it("wraps every dock button — apps AND folders — in the canonical VdTooltip", () => {
    expect(source).toMatch(/@components\/vd\/tooltip/);
    // One wrapper per render branch (app, folder): every button sits inside
    // a VdTooltip, none outside.
    expect((source.match(/<VdTooltip /g) ?? []).length).toBe(2);
    expect((source.match(/<\/VdTooltip>/g) ?? []).length).toBe(2);
    // 022: the raw <button> moved into the DockEntityButton helper — one
    // button element, wrapped by VdTooltip at both call sites.
    expect((source.match(/<button/g) ?? []).length).toBe(1);
  });

  it("mounts ONE provider so moving between icons re-opens instead of flickering", () => {
    expect(source).toMatch(/import \{ VdTooltip, VdTooltipProvider \} from "@components\/vd\/tooltip"/);
    expect((source.match(/<VdTooltipProvider/g) ?? []).length).toBe(1);
    expect(source).toMatch(/skipDelayDuration=\{120\}/);
  });

  it("tooltip text is the entity name — never a URL, an icon id or an entity id", () => {
    expect((source.match(/content=\{entity\.name\}/g) ?? []).length).toBe(2);
    expect(source).not.toMatch(/content=\{t\(/);
  });

  it("keeps the localized open-label as the accessible name; tooltip is supplemental", () => {
    // 022: the label flows through the DockEntityButton ariaLabel prop onto
    // the single button element.
    expect(source).toMatch(/ariaLabel=\{t\("dock\.openApp", \{ name: entity\.name \}\)\}/);
    expect(source).toMatch(/ariaLabel=\{t\("dock\.openFolder", \{ name: entity\.name \}\)\}/);
    expect(source).toMatch(/aria-label=\{ariaLabel\}/);
  });

  it("replaced the native title tooltips entirely", () => {
    expect(source).not.toMatch(/title=/);
  });

  it("tooltip identity is independent of the desktop label preference (labelVisible)", () => {
    // labelVisible is a DESKTOP presentation preference; the dock tooltip
    // reads entity.name unconditionally and consults no presentation state.
    expect(source).not.toMatch(/labelVisible/);
    expect(source).not.toMatch(/appLabelPresentation/);
  });

  it("tooltips live outside the dock layout flow (portalled by VdTooltip)", () => {
    // VdTooltip portals its content to the themed overlay root — nothing
    // tooltip-related renders inside the nav's flex flow, so dock width,
    // spacing and geometry are untouchable.
    expect(source).not.toMatch(/vela-dock__tooltip/);
    const css = readFileSync(fileURLToPath(new URL("./home-shell.css", import.meta.url)), "utf8");
    expect(css).not.toMatch(/\.vela-dock__tooltip/);
  });
});
