import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { buildSnapshot, cleanupLocalStores, manualClock, openTestStore, renamedSnapshot } from "./test-support";

afterEach(async () => {
  await cleanupLocalStores();
});

describe("hydrateWorkspaceFromServer", () => {
  it("creates a clean generation-0 working copy for a new server workspace", async () => {
    const clock = manualClock(5_000);
    const store = await openTestStore({ now: clock.now });
    const snapshot = buildSnapshot("ws-new");

    const result = await store.hydrateWorkspaceFromServer(snapshot, 3);

    expect(result).toEqual({
      ok: true,
      workspace: {
        id: "ws-new",
        snapshot,
        serverRevision: 3,
        localGeneration: 0,
        syncState: "clean",
        updatedAt: 5_000,
        lastSyncedAt: 5_000,
      },
    });
    const stored = await store.getWorkspace("ws-new");
    expect(stored?.conflictRevision).toBeUndefined();
    expect(await store.getOutboxEntry("ws-new")).toBeUndefined();
    expect(clock.reads()).toBe(1);
  });

  it("accepts an equal-revision refresh and replaces the snapshot", async () => {
    const clock = manualClock(5_000);
    const store = await openTestStore({ now: clock.now });

    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-ref", "First"), 5);
    clock.advance(100);
    const result = await store.hydrateWorkspaceFromServer(buildSnapshot("ws-ref", "Second"), 5);

    expect(result.ok).toBe(true);
    const record = await store.getWorkspace("ws-ref");
    expect(record?.snapshot.name).toBe("Second");
    expect(record?.serverRevision).toBe(5);
    expect(record?.syncState).toBe("clean");
    expect(record?.updatedAt).toBe(5_100);
    expect(record?.lastSyncedAt).toBe(5_100);
  });

  it("accepts a newer revision refresh and preserves the local generation", async () => {
    const store = await openTestStore();
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-up"), 2);

    const result = await store.hydrateWorkspaceFromServer(renamedSnapshot(buildSnapshot("ws-up"), "Refreshed"), 7);

    expect(result.ok).toBe(true);
    const record = await store.getWorkspace("ws-up");
    expect(record?.serverRevision).toBe(7);
    expect(record?.localGeneration).toBe(0);
    expect(record?.snapshot.name).toBe("Refreshed");
  });

  it("rejects an older revision without touching the local record", async () => {
    const clock = manualClock(5_000);
    const store = await openTestStore({ now: clock.now });
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-old", "Current"), 7);

    const result = await store.hydrateWorkspaceFromServer(buildSnapshot("ws-old", "Stale"), 6);

    expect(result).toEqual({
      ok: false,
      reason: "stale-server-revision",
      currentRevision: 7,
    });
    const record = await store.getWorkspace("ws-old");
    expect(record?.snapshot.name).toBe("Current");
    expect(record?.serverRevision).toBe(7);
    expect(record?.updatedAt).toBe(5_000);
    expect(record?.lastSyncedAt).toBe(5_000);
  });

  it("preserves the full snapshot structure through hydration", async () => {
    const store = await openTestStore();
    const snapshot = buildSnapshot("ws-full", "Structure");

    await store.hydrateWorkspaceFromServer(snapshot, 1);

    const record = await store.getWorkspace("ws-full");
    expect(record?.snapshot).toEqual(snapshot);
    expect(record?.snapshot.pages[0]?.layout.items).toEqual([]);
  });

  it("does not mutate the input snapshot", async () => {
    const store = await openTestStore();
    const snapshot = buildSnapshot("ws-input", "Input");
    const before = structuredClone(snapshot);

    await store.hydrateWorkspaceFromServer(snapshot, 2);

    expect(snapshot).toEqual(before);
  });

  it("rejects a domain-invalid snapshot without writing anything", async () => {
    const store = await openTestStore();
    const invalid: WorkspaceSnapshot = {
      ...buildSnapshot("ws-invalid"),
      entities: [
        {
          kind: "app",
          id: "app-1",
          name: "",
          url: "https://example.com",
          icon: { kind: "favicon" },
          openMode: "new-tab",
          tags: [],
        },
      ],
    };

    const result = await store.hydrateWorkspaceFromServer(invalid, 1);

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid-workspace") {
      expect(result.issues.length).toBeGreaterThan(0);
    } else {
      expect.unreachable("expected invalid-workspace result");
    }
    expect(await store.getWorkspace("ws-invalid")).toBeUndefined();
  });

  it("rejects a blank workspace id through domain validation", async () => {
    const store = await openTestStore();
    const blankId = { ...buildSnapshot("placeholder"), id: "   " };

    const result = await store.hydrateWorkspaceFromServer(blankId, 1);

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid-workspace") {
      expect(result.issues.some((issue) => issue.type === "invalid-workspace-id")).toBe(true);
    } else {
      expect.unreachable("expected invalid-workspace result");
    }
    expect(await store.getWorkspace("   ")).toBeUndefined();
  });

  it("throws RangeError for a non-positive server revision and writes nothing", async () => {
    const store = await openTestStore();

    await expect(store.hydrateWorkspaceFromServer(buildSnapshot("ws-rev"), 0)).rejects.toThrow(RangeError);
    await expect(store.hydrateWorkspaceFromServer(buildSnapshot("ws-rev"), -3)).rejects.toThrow(RangeError);
    await expect(store.hydrateWorkspaceFromServer(buildSnapshot("ws-rev"), 1.5)).rejects.toThrow(RangeError);
    await expect(store.hydrateWorkspaceFromServer(buildSnapshot("ws-rev"), Number.NaN)).rejects.toThrow(RangeError);

    expect(await store.getWorkspace("ws-rev")).toBeUndefined();
    expect(await store.listWorkspaces()).toEqual([]);
  });
});
