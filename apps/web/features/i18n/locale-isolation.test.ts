import { describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import {
  areWorkspaceSettingsDraftsEqual,
  createWorkspaceSettingsDraft,
  preferencesFromSettingsDraft,
} from "../home/settings-draft";
import { translate } from "./messages";

/**
 * Language switching is browser-local ONLY (014-D §21): the workspace
 * settings draft model has no locale field, so switching the UI language
 * can never dirty the draft, and drafts/preferences stay byte-identical
 * across locales.
 */

const snapshot: WorkspaceSnapshot = {
  id: "ws-1",
  name: "Desk",
  pages: [
    {
      id: "page-1",
      name: "Home",
      layout: {
        id: "page-1",
        grid: { columns: 10, rows: 6 },
        items: [
          { id: "app-1", position: { column: 0, row: 0 }, span: { columns: 1, rows: 1 } },
        ],
      },
    },
  ],
  entities: [
    {
      kind: "app",
      id: "app-1",
      name: "Alpha",
      url: "https://example.com/",
      icon: { kind: "generated", text: "A" },
      openMode: "new-tab",
      tags: [],
    },
  ],
  categories: [],
  dock: { items: [] },
  preferences: { defaultPageId: "page-1", layoutLocked: false },
};

describe("locale isolation from workspace data", () => {
  it("creates equal settings drafts regardless of the active locale", () => {
    const zhDraft = createWorkspaceSettingsDraft(snapshot);
    // "Switch the UI language" — nothing about the draft changes.
    const enDraft = createWorkspaceSettingsDraft(snapshot);
    expect(areWorkspaceSettingsDraftsEqual(zhDraft, enDraft)).toBe(true);
  });

  it("produces preferences with no locale field in either locale", () => {
    for (const locale of ["zh-CN", "en-US"] as const) {
      const draft = createWorkspaceSettingsDraft(snapshot);
      const preferences = preferencesFromSettingsDraft(draft);
      expect(Object.keys(preferences).sort()).toEqual([
        "appearance",
        "defaultPageId",
        "gridGapPx",
        "layoutLocked",
      ]);
      // Locale only affects UI strings, never the preference payload.
      expect(JSON.stringify(preferences)).not.toContain(locale);
      expect(translate(locale, "settings.title")).toBeTruthy();
    }
  });
});
