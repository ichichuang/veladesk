import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import {
  buildSnapshot,
  cleanupLocalStores,
  manualClock,
  nextDatabaseName,
  openTestStore,
  seedWorkspaceRecord,
} from "./test-support";

afterEach(async () => {
  await cleanupLocalStores();
});

describe("stageWorkspaceCreate", () => {
  it("stages a local create as dirty with a create outbox in one write", async () => {
    const clock = manualClock(10_000);
    const store = await openTestStore({ now: clock.now });
    const snapshot = buildSnapshot("ws-create");

    const result = await store.stageWorkspaceCreate(snapshot);

    expect(result).toEqual({
      ok: true,
      workspace: {
        id: "ws-create",
        snapshot,
        serverRevision: null,
        localGeneration: 1,
        syncState: "dirty",
        updatedAt: 10_000,
        lastSyncedAt: null,
      },
      outbox: {
        workspaceId: "ws-create",
        operation: "create",
        baseRevision: null,
        snapshot,
        localGeneration: 1,
        queuedAt: 10_000,
      },
    });
    expect(clock.reads()).toBe(1);
    expect((await store.listOutboxEntries()).length).toBe(1);
  });

  it("rejects a duplicate local create and keeps the original record", async () => {
    const clock = manualClock(10_000);
    const store = await openTestStore({ now: clock.now });
    await store.stageWorkspaceCreate(buildSnapshot("ws-dup", "First"));
    clock.advance(50);

    const result = await store.stageWorkspaceCreate(buildSnapshot("ws-dup", "Second"));

    expect(result).toEqual({ ok: false, reason: "already-exists" });
    const record = await store.getWorkspace("ws-dup");
    expect(record?.snapshot.name).toBe("First");
    expect(record?.updatedAt).toBe(10_000);
    expect((await store.listOutboxEntries()).length).toBe(1);
  });

  it("rejects a domain-invalid snapshot without writing anything", async () => {
    const store = await openTestStore();
    const invalid = { ...buildSnapshot("ws-bad"), name: "   " };

    const result = await store.stageWorkspaceCreate(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid-workspace") {
      expect(result.issues.some((issue) => issue.type === "invalid-workspace-name")).toBe(true);
    } else {
      expect.unreachable("expected invalid-workspace result");
    }
    expect(await store.getWorkspace("ws-bad")).toBeUndefined();
    expect(await store.listOutboxEntries()).toEqual([]);
  });

  it("rejects a snapshot with an invalid page grid and writes no record or outbox entry", async () => {
    const store = await openTestStore();
    const base = buildSnapshot("ws-grid");
    const page = base.pages[0]!;
    const invalid: WorkspaceSnapshot = {
      ...base,
      pages: [
        {
          ...page,
          layout: { ...page.layout, grid: { columns: 0, rows: 4 }, items: [] },
        },
      ],
    };

    const result = await store.stageWorkspaceCreate(invalid);

    expect(result).toEqual({
      ok: false,
      reason: "invalid-workspace",
      issues: [
        {
          type: "page-layout-invalid",
          pageId: "ws-grid-page",
          issue: { type: "invalid-grid" },
        },
      ],
    });
    expect(await store.getWorkspace("ws-grid")).toBeUndefined();
    expect(await store.getOutboxEntry("ws-grid")).toBeUndefined();
  });

  it("does not mutate the input snapshot", async () => {
    const store = await openTestStore();
    const snapshot = buildSnapshot("ws-immutable");
    const before = structuredClone(snapshot);

    await store.stageWorkspaceCreate(snapshot);

    expect(snapshot).toEqual(before);
  });

  it("throws RangeError for an invalid clock and writes nothing", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1]) {
      const store = await openTestStore({ now: () => bad });

      await expect(store.stageWorkspaceCreate(buildSnapshot("ws-clock"))).rejects.toThrow(RangeError);

      expect(await store.getWorkspace("ws-clock")).toBeUndefined();
      expect(await store.listOutboxEntries()).toEqual([]);
    }
  });
});

describe("stageWorkspaceUpdate", () => {
  it("rejects an update for a missing workspace", async () => {
    const store = await openTestStore();

    const result = await store.stageWorkspaceUpdate(buildSnapshot("ws-missing"));

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("updates a clean server copy into a save outbox based on its revision", async () => {
    const clock = manualClock(20_000);
    const store = await openTestStore({ now: clock.now });
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-save", "Original"), 3);
    clock.advance(100);

    const result = await store.stageWorkspaceUpdate(buildSnapshot("ws-save", "Edited"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.serverRevision).toBe(3);
      expect(result.workspace.localGeneration).toBe(1);
      expect(result.workspace.syncState).toBe("dirty");
      expect(result.workspace.updatedAt).toBe(20_100);
      expect(result.workspace.lastSyncedAt).toBe(20_000);
      expect(result.outbox.operation).toBe("save");
      expect(result.outbox.baseRevision).toBe(3);
      expect(result.outbox.localGeneration).toBe(1);
    }
    expect(clock.reads()).toBe(2); // one for hydration, one for the update
  });

  it("keeps the create operation for an offline-created workspace", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-offline", "v1"));

    const result = await store.stageWorkspaceUpdate(buildSnapshot("ws-offline", "v2"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outbox.operation).toBe("create");
      expect(result.outbox.baseRevision).toBeNull();
      expect(result.workspace.serverRevision).toBeNull();
    }
  });

  it("coalesces multiple updates into a single outbox entry", async () => {
    const clock = manualClock(30_000);
    const store = await openTestStore({ now: clock.now });
    await store.stageWorkspaceCreate(buildSnapshot("ws-coalesce", "v1"));

    clock.advance(10);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-coalesce", "v2"));
    clock.advance(10);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-coalesce", "v3"));
    clock.advance(10);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-coalesce", "v4"));

    const outbox = await store.listOutboxEntries();
    expect(outbox.length).toBe(1);
    const entry = outbox[0];
    expect(entry?.snapshot.name).toBe("v4");
    expect(entry?.localGeneration).toBe(4);
    expect(entry?.queuedAt).toBe(30_000);
    const record = await store.getWorkspace("ws-coalesce");
    expect(record?.localGeneration).toBe(4);
    expect(record?.snapshot.name).toBe("v4");
    expect(record?.syncState).toBe("dirty");
  });

  it("preserves lastSyncedAt across local updates", async () => {
    const clock = manualClock(40_000);
    const store = await openTestStore({ now: clock.now });
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-synced"), 2);
    clock.advance(100);

    await store.stageWorkspaceUpdate(buildSnapshot("ws-synced"));

    const record = await store.getWorkspace("ws-synced");
    expect(record?.lastSyncedAt).toBe(40_000);
    expect(record?.updatedAt).toBe(40_100);
  });

  it("does not mutate the input snapshot on update", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-imm-2"));
    const snapshot = buildSnapshot("ws-imm-2", "New Name");
    const before = structuredClone(snapshot);

    await store.stageWorkspaceUpdate(snapshot);

    expect(snapshot).toEqual(before);
  });

  it("throws RangeError instead of overflowing a maximal generation", async () => {
    const databaseName = nextDatabaseName();
    await seedWorkspaceRecord(databaseName, {
      id: "ws-max",
      snapshot: buildSnapshot("ws-max"),
      serverRevision: 4,
      localGeneration: Number.MAX_SAFE_INTEGER,
      syncState: "dirty",
      updatedAt: 1,
      lastSyncedAt: 1,
    });
    const store = await openTestStore({ databaseName });

    await expect(store.stageWorkspaceUpdate(buildSnapshot("ws-max", "Overflow"))).rejects.toThrow(
      RangeError
    );

    const record = await store.getWorkspace("ws-max");
    expect(record?.localGeneration).toBe(Number.MAX_SAFE_INTEGER);
    expect(record?.snapshot.name).toBe("Test Desk");
  });

  it("blocks server hydration of a dirty working copy", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-dirty", "Local"));

    const result = await store.hydrateWorkspaceFromServer(buildSnapshot("ws-dirty", "Server"), 5);

    expect(result).toEqual({ ok: false, reason: "local-changes-present" });
    const record = await store.getWorkspace("ws-dirty");
    expect(record?.snapshot.name).toBe("Local");
    expect(record?.syncState).toBe("dirty");
  });
});

describe("outbox listing order", () => {
  it("orders entries by queuedAt then workspaceId with a fixed tie-break", async () => {
    const clock = manualClock(50_000);
    const store = await openTestStore({ now: clock.now });

    await store.stageWorkspaceCreate(buildSnapshot("ws-b"));
    clock.advance(10);
    await store.stageWorkspaceCreate(buildSnapshot("ws-c"));
    // Same clock value as ws-c: tie must break by workspaceId ascending.
    await store.stageWorkspaceCreate(buildSnapshot("ws-a2"));
    clock.advance(10);
    await store.stageWorkspaceCreate(buildSnapshot("ws-a1"));

    const entries = await store.listOutboxEntries();
    expect(entries.map((entry) => entry.workspaceId)).toEqual([
      "ws-b",
      "ws-a2",
      "ws-c",
      "ws-a1",
    ]);
  });
});

describe("reopen persistence of staged state", () => {
  it("keeps a staged workspace and outbox after close and reopen", async () => {
    const clock = manualClock(60_000);
    const databaseName = nextDatabaseName();

    const first = await openTestStore({ databaseName, now: clock.now });
    await first.stageWorkspaceCreate(buildSnapshot("ws-persist", "v1"));
    clock.advance(10);
    await first.stageWorkspaceUpdate(buildSnapshot("ws-persist", "v2"));
    first.close();

    const reopened = await openTestStore({ databaseName, now: clock.now });
    const record = await reopened.getWorkspace("ws-persist");
    expect(record).toBeDefined();
    expect(record?.snapshot.name).toBe("v2");
    expect(record?.localGeneration).toBe(2);
    expect(record?.syncState).toBe("dirty");
    expect(record?.serverRevision).toBeNull();
    expect(record?.updatedAt).toBe(60_010);

    const outbox = await reopened.getOutboxEntry("ws-persist");
    expect(outbox).toBeDefined();
    expect(outbox?.operation).toBe("create");
    expect(outbox?.baseRevision).toBeNull();
    expect(outbox?.snapshot.name).toBe("v2");
    expect(outbox?.localGeneration).toBe(2);
    expect(outbox?.queuedAt).toBe(60_000);
  });
});
