import { describe, expect, it } from "vitest";
import type { AppShortcut, Folder, WorkspaceSnapshot } from "@veladesk/domain";

import { openAppearanceSession, projectRenderedWorkspace } from "./app-appearance-session";
import { resolveAppContentLayoutForApp } from "./app-content-layout";
import { appLabelPresentation, appVisual } from "./app-icon";

/**
 * The "Show application name" switch chain, integrated (task 020-A1 §16–§17):
 *
 *   Switch callback(false)
 *     → the inspector's patch → session draft.labelVisible
 *     → projectRenderedWorkspace(...)
 *     → effective app visual.labelVisible
 *     → the SAME renderer helpers DesktopItem uses report title hidden /
 *       solo mode
 *
 * and back to visible on callback(true), with zero workspace mutation
 * until Save (§19) and Cancel restoring the persisted value.
 */

function makeApp(overrides: Partial<AppShortcut> = {}): AppShortcut {
  return {
    kind: "app",
    id: "app-1",
    name: "GitHub",
    url: "https://github.com",
    icon: { kind: "generated", text: "GI", source: "auto" },
    openMode: "new-tab",
    tags: [],
    ...overrides,
  };
}

function makeWorkspace(apps: readonly AppShortcut[]): WorkspaceSnapshot {
  const folder: Folder = { kind: "folder", id: "folder-1", name: "Tools", children: [] };
  return {
    id: "ws-1",
    name: "Desk",
    pages: [
      {
        id: "page-1",
        name: "Home",
        layout: { id: "page-1", grid: { columns: 12, rows: 8 }, items: [] },
        canvas: { version: 2, mode: "grid", columns: 12, items: [] },
      },
    ],
    entities: [...apps, folder],
    categories: [],
    dock: { items: [] },
    preferences: { defaultPageId: "page-1", layoutLocked: true },
  };
}

const APP = makeApp();
const WORKSPACE = makeWorkspace([APP]);

/** Exactly what the inspector's Switch onChange produces (020-A1 §16). */
function applySwitchCallback(session: ReturnType<typeof openAppearanceSession>, value: boolean) {
  return { ...session, draft: { ...session.draft, labelVisible: value } };
}

function renderedApp(rendered: WorkspaceSnapshot): AppShortcut {
  const entity = rendered.entities.find((candidate) => candidate.id === APP.id);
  if (entity === undefined || entity.kind !== "app") {
    throw new Error("projected app missing");
  }
  return entity;
}

describe("label-visible switch → desktop projection chain", () => {
  it("switch OFF hides the title: solo mode through the real renderer helpers", () => {
    const session = applySwitchCallback(openAppearanceSession(APP), false);
    const rendered = projectRenderedWorkspace(WORKSPACE, session);
    const effective = renderedApp(rendered);

    expect(effective.visual?.labelVisible).toBe(false);
    // What DesktopItem actually consults before rendering the title node:
    expect(appLabelPresentation(appVisual(effective)).visible).toBe(false);
    expect(resolveAppContentLayoutForApp(effective, 90, 90).mode).toBe("solo");
  });

  it("switch ON shows the title again: stack mode, label visible", () => {
    const hidden = applySwitchCallback(openAppearanceSession(APP), false);
    const shown = applySwitchCallback(hidden, true);
    const rendered = projectRenderedWorkspace(WORKSPACE, shown);
    const effective = renderedApp(rendered);

    expect(appLabelPresentation(appVisual(effective)).visible).toBe(true);
    expect(resolveAppContentLayoutForApp(effective, 90, 90).mode).toBe("stack");
  });

  it("toggle preview never mutates the persisted snapshot (§19)", () => {
    const session = applySwitchCallback(openAppearanceSession(APP), false);
    projectRenderedWorkspace(WORKSPACE, session);
    expect(WORKSPACE.entities[0]).toEqual(APP);
    const persisted = WORKSPACE.entities.find((entity) => entity.id === APP.id);
    expect((persisted as AppShortcut).visual?.labelVisible ?? true).toBe(true);
  });

  it("cancel restores the persisted value by identity (no re-projection)", () => {
    expect(projectRenderedWorkspace(WORKSPACE, null)).toBe(WORKSPACE);
    const cancelled = projectRenderedWorkspace(WORKSPACE, null);
    expect(appLabelPresentation(appVisual(renderedApp(cancelled))).visible).toBe(true);
  });
});
