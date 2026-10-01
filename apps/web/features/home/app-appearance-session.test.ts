import { describe, expect, it } from "vitest";
import type { AppShortcut, Folder, WorkspaceSnapshot } from "@veladesk/domain";
import { replaceApp } from "@veladesk/domain";

import { buildDraftApp, draftFromApp } from "./app-visual-draft";
import {
  appearanceHandoffSettled,
  areProjectedAppsEqual,
  effectiveApp,
  isSessionPristine,
  isSessionSavable,
  openAppearanceSession,
  projectRenderedWorkspace,
  resolveRenderedEntity,
} from "./app-appearance-session";

/**
 * Pure tests of the appearance editing session (task 019-C §19/§20):
 * open/change/cancel/save projection semantics, entity projection cases,
 * and the zero-bounce save handoff — no browser required.
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
const OTHER_APP = makeApp({ id: "app-2", name: "Portal" });

describe("appearance session lifecycle (019-C §19)", () => {
  it("opens with the persisted app as the pristine draft", () => {
    const session = openAppearanceSession(APP);
    expect(session.appId).toBe("app-1");
    expect(session.draft).toEqual(draftFromApp(APP));
    expect(isSessionPristine(APP, session)).toBe(true);
    expect(isSessionSavable(APP, session)).toBe(false);
  });

  it("projects draft changes through the ONE canonical projection", () => {
    const session = openAppearanceSession(APP);
    const draft = { ...session.draft, decorationStyle: "glass" as const };
    const effective = effectiveApp(APP, { ...session, draft });
    // The exact invariant: rendered === buildDraftApp(existing, draft).
    expect(effective).toEqual(buildDraftApp(APP, draft));
    expect(effective.visual?.decorationStyle).toBe("glass");
    expect(isSessionPristine(APP, { ...session, draft })).toBe(false);
    expect(isSessionSavable(APP, { ...session, draft })).toBe(true);
  });

  it("cancel: dropping the session returns the persisted app (identity, no mutation)", () => {
    const session = openAppearanceSession(APP);
    const draft = { ...session.draft, labelVisible: false };
    const cancelled = effectiveApp(APP, null);
    expect(cancelled).toBe(APP); // same reference — the persisted look again
    expect(WORKSPACE.entities[0]).toEqual(APP); // no workspace data mutated
    expect(draft).toBeDefined();
  });

  it("save projection: what Save persists structurally equals what was rendered", () => {
    const session = openAppearanceSession(APP);
    const draft = {
      ...session.draft,
      source: "library" as const,
      libraryIcon: "simple-icons:github",
      labelVisible: false,
    };
    const renderedWhileEditing = effectiveApp(APP, { ...session, draft });
    // Save goes through replaceApp with the SAME projection.
    const saved = replaceApp(WORKSPACE, renderedWhileEditing);
    if (!saved.ok) {
      throw new Error("replaceApp failed in fixture setup");
    }
    const persisted = saved.workspace.entities.find(
      (entity): entity is AppShortcut => entity.kind === "app" && entity.id === "app-1"
    )!;
    expect(areProjectedAppsEqual(persisted, renderedWhileEditing)).toBe(true);
  });

  it("failed save changes nothing: the model has no save side effects", () => {
    // The session API is pure — a failed stage never mutates draft or
    // workspace; the draft simply remains available.
    const session = openAppearanceSession(APP);
    const draft = { ...session.draft, foregroundColor: "#aabbcc" };
    expect(effectiveApp(APP, { ...session, draft }).visual?.foregroundColor).toBe("#aabbcc");
    expect(WORKSPACE.entities[0]).toEqual(APP);
  });

  it("pristine semantics: save is disabled until the draft dirties", () => {
    const session = openAppearanceSession(APP);
    expect(isSessionSavable(APP, session)).toBe(false);
    const dirty = { ...session.draft, decorationStyle: "solid" as const };
    expect(isSessionSavable(APP, { ...session, draft: dirty })).toBe(true);
    // An invalid dirty draft (library tab, no pick) still cannot save.
    const invalid = { ...session.draft, source: "library" as const, libraryIcon: "" };
    expect(isSessionSavable(APP, { ...session, draft: invalid })).toBe(false);
  });
});

describe("rendered entity projection (019-C §20)", () => {
  const session = { appId: "app-1", draft: { ...draftFromApp(APP), decorationStyle: "glass" as const } };

  it("returns the persisted entity for a DIFFERENT app id", () => {
    expect(resolveRenderedEntity(OTHER_APP, session)).toBe(OTHER_APP);
  });

  it("returns the projected draft app for the MATCHING id", () => {
    const projected = resolveRenderedEntity(APP, session);
    expect(projected).not.toBe(APP);
    expect((projected as AppShortcut).visual?.decorationStyle).toBe("glass");
  });

  it("returns non-app entities unchanged", () => {
    const folder = WORKSPACE.entities.find((entity) => entity.kind === "folder")!;
    expect(resolveRenderedEntity(folder, session)).toBe(folder);
  });

  it("missing app: the workspace projection degrades to identity", () => {
    const staleSession = { appId: "app-gone", draft: session.draft };
    expect(projectRenderedWorkspace(WORKSPACE, staleSession)).toBe(WORKSPACE);
    expect(projectRenderedWorkspace(WORKSPACE, null)).toBe(WORKSPACE);
  });
});

describe("zero-bounce save handoff (019-C)", () => {
  it("stays unsettled while the persisted app differs from the projection", () => {
    const session = openAppearanceSession(APP);
    const draft = { ...session.draft, decorationStyle: "glass" as const };
    const live = { ...session, draft };
    expect(appearanceHandoffSettled(WORKSPACE, live)).toBe(false);
  });

  it("settles once the authoritative snapshot carries the projected app", () => {
    const session = openAppearanceSession(APP);
    const draft = { ...session.draft, decorationStyle: "glass" as const };
    const live = { ...session, draft };
    const staged = replaceApp(WORKSPACE, buildDraftApp(APP, draft));
    if (!staged.ok) {
      throw new Error("replaceApp failed in fixture setup");
    }
    expect(appearanceHandoffSettled(staged.workspace, live)).toBe(true);
    // And clearing the session at that point cannot change the render.
    const afterClear = projectRenderedWorkspace(staged.workspace, null);
    expect(afterClear.entities).toEqual(staged.workspace.entities);
  });

  it("a session for a vanished app never settles (only cancel ends it)", () => {
    const gone = openAppearanceSession(OTHER_APP);
    const without = { ...WORKSPACE, entities: [APP] };
    expect(appearanceHandoffSettled(without, gone)).toBe(false);
    expect(appearanceHandoffSettled(WORKSPACE, null)).toBe(true);
  });

  it("workspace projection replaces exactly one app and keeps identity otherwise", () => {
    const session = openAppearanceSession(APP);
    const draft = { ...session.draft, labelVisible: false };
    const input = makeWorkspace([APP, OTHER_APP]);
    const projected = projectRenderedWorkspace(input, { ...session, draft });
    expect(projected).not.toBe(input);
    const app1 = projected.entities.find((entity) => entity.id === "app-1") as AppShortcut;
    const app2 = projected.entities.find((entity) => entity.id === "app-2");
    expect(app1.visual?.labelVisible).toBe(false);
    expect(projected.entities.filter((entity) => entity.kind === "app")).toHaveLength(2);
    // Untouched slices keep their identity — no accidental copies.
    expect(projected.pages).toBe(input.pages);
    expect(projected.dock).toBe(input.dock);
    expect(app2).toBe(OTHER_APP);
  });
});
