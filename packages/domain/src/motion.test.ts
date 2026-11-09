import { describe, expect, it } from "vitest";

import { decodeWorkspaceSnapshot } from "./decoding";
import {
  DEFAULT_REDUCED_MOTION,
  resolveHelmMotionEnabled,
  resolveReducedMotionPreference,
  validateWorkspaceMotion,
} from "./motion";
import { validateWorkspace } from "./validation";
import { createEmptyWorkspace } from "./workspace";
import type { WorkspacePreferences } from "./types";

const preferences = (motion: WorkspacePreferences["motion"]): WorkspacePreferences =>
  motion === undefined
    ? { defaultPageId: "page-1", layoutLocked: false }
    : { defaultPageId: "page-1", layoutLocked: false, motion };

describe("resolveHelmMotionEnabled (P1 experiment flag)", () => {
  it("defaults to false — experiments never ship enabled", () => {
    expect(resolveHelmMotionEnabled(preferences(undefined))).toBe(false);
    expect(resolveHelmMotionEnabled(preferences({}))).toBe(false);
    expect(resolveHelmMotionEnabled(preferences({ experiments: {} }))).toBe(false);
  });

  it("enables only on an explicit true", () => {
    expect(
      resolveHelmMotionEnabled(preferences({ experiments: { helmMotion: true } }))
    ).toBe(true);
    expect(
      resolveHelmMotionEnabled(preferences({ experiments: { helmMotion: false } }))
    ).toBe(false);
  });
});

describe("resolveReducedMotionPreference", () => {
  it("resolves legacy snapshots to the system default", () => {
    expect(preferences(undefined)).toBeTruthy();
    expect(resolveReducedMotionPreference(preferences(undefined))).toBe(DEFAULT_REDUCED_MOTION);
    expect(DEFAULT_REDUCED_MOTION).toBe("system");
  });

  it("passes explicit choices through", () => {
    for (const value of ["system", "on", "off"] as const) {
      expect(resolveReducedMotionPreference(preferences({ reducedMotion: value }))).toBe(value);
    }
  });
});

describe("validateWorkspaceMotion", () => {
  it("accepts absent values and every legal choice", () => {
    expect(validateWorkspaceMotion({})).toEqual([]);
    expect(
      validateWorkspaceMotion({ reducedMotion: "on", experiments: { helmMotion: true } })
    ).toEqual([]);
  });

  it("rejects unknown enum words and non-boolean switches in fixed order", () => {
    expect(
      validateWorkspaceMotion({
        reducedMotion: "sometimes" as never,
        experiments: { helmMotion: "yes" as never },
      })
    ).toEqual([
      { type: "invalid-reduced-motion" },
      { type: "invalid-motion-experiment" },
    ]);
  });
});

describe("snapshot round trip", () => {
  const base = createEmptyWorkspace({
    workspaceId: "workspace-1",
    workspaceName: "My Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 10, rows: 6 },
  });

  const withMotion = {
    ...base,
    preferences: {
      ...base.preferences,
      motion: { reducedMotion: "off" as const, experiments: { helmMotion: true } },
    },
  };

  it("decodes persisted motion preferences and keeps them valid", () => {
    const decoded = decodeWorkspaceSnapshot(JSON.parse(JSON.stringify(withMotion)));
    expect(decoded?.preferences.motion).toEqual({
      reducedMotion: "off",
      experiments: { helmMotion: true },
    });
    expect(validateWorkspace(decoded!)).toEqual([]);
  });

  it("rejects a structurally invalid motion block at the decode boundary", () => {
    const broken = JSON.parse(
      JSON.stringify({ ...withMotion, preferences: { ...withMotion.preferences, motion: { experiments: { helmMotion: "yes" } } } })
    );
    expect(decodeWorkspaceSnapshot(broken)).toBeUndefined();
  });

  it("keeps legacy snapshots without motion decodable forever", () => {
    const legacy = JSON.parse(JSON.stringify(base));
    expect(decodeWorkspaceSnapshot(legacy)?.preferences.motion).toBeUndefined();
  });
});
