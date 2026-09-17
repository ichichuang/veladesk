import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import { buildSnapshot, cleanupLocalStores, manualClock, openTestStore } from "./test-support";
import type { AcknowledgeWorkspaceSyncInput, LocalWorkspaceStore } from "./types";

afterEach(async () => {
  await cleanupLocalStores();
});

function ackInput(
  workspaceId: string,
  localGeneration: number,
  serverSnapshot: WorkspaceSnapshot,
  serverRevision: number
): AcknowledgeWorkspaceSyncInput {
  return { workspaceId, localGeneration, serverSnapshot, serverRevision };
}

describe("acknowledgeWorkspaceSync — clean success", () => {
  it("acknowledges a create: clean at revision 1, outbox deleted", async () => {
    const clock = manualClock(70_000);
    const store = await openTestStore({ now: clock.now });
    await store.stageWorkspaceCreate(buildSnapshot("ws-ack", "Local Name"));
    const updatedAtBefore = (await store.getWorkspace("ws-ack"))?.updatedAt;
    clock.advance(100);

    const canonical = buildSnapshot("ws-ack", "Server Canonical");
    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-ack", 1, canonical, 1)
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("outbox" in result).toBe(false);
      expect(result.workspace.snapshot).toEqual(canonical);
      expect(result.workspace.serverRevision).toBe(1);
      expect(result.workspace.syncState).toBe("clean");
      expect(result.workspace.conflictRevision).toBeUndefined();
      expect(result.workspace.lastSyncedAt).toBe(70_100);
      expect(result.workspace.updatedAt).toBe(updatedAtBefore);
    }
    expect(await store.getOutboxEntry("ws-ack")).toBeUndefined();
    expect(await store.listOutboxEntries()).toEqual([]);
  });

  it("acknowledges a save: clean at the new revision", async () => {
    const clock = manualClock(70_000);
    const store = await openTestStore({ now: clock.now });
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-ack2"), 2);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-ack2", "Edited"));

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-ack2", 1, buildSnapshot("ws-ack2", "Edited"), 3)
    );

    expect(result.ok).toBe(true);
    const record = await store.getWorkspace("ws-ack2");
    expect(record?.syncState).toBe("clean");
    expect(record?.serverRevision).toBe(3);
    expect(record?.snapshot.name).toBe("Edited");
    expect(await store.getOutboxEntry("ws-ack2")).toBeUndefined();
  });
});

describe("acknowledgeWorkspaceSync — local edited while request in flight", () => {
  it("keeps the newer local edit and converts a pending create into a save", async () => {
    const clock = manualClock(80_000);
    const store = await openTestStore({ now: clock.now });
    await store.stageWorkspaceCreate(buildSnapshot("ws-flight", "v1")); // generation 1 sent
    clock.advance(10);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-flight", "v2")); // generation 2 local
    clock.advance(10);

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-flight", 1, buildSnapshot("ws-flight", "server v1"), 1)
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.snapshot.name).toBe("v2");
      expect(result.workspace.localGeneration).toBe(2);
      expect(result.workspace.syncState).toBe("dirty");
      expect(result.workspace.serverRevision).toBe(1);
      expect(result.workspace.lastSyncedAt).toBe(80_020);
      expect(result.outbox).toBeDefined();
      expect(result.outbox?.operation).toBe("save");
      expect(result.outbox?.baseRevision).toBe(1);
      expect(result.outbox?.snapshot.name).toBe("v2");
      expect(result.outbox?.localGeneration).toBe(2);
      expect(result.outbox?.queuedAt).toBe(80_000);
    }
    const outbox = await store.getOutboxEntry("ws-flight");
    expect(outbox?.operation).toBe("save");
    expect(outbox?.baseRevision).toBe(1);
  });

  it("keeps the newer local edit on a save and advances the outbox base revision", async () => {
    const clock = manualClock(80_000);
    const store = await openTestStore({ now: clock.now });
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-flight2"), 2);
    clock.advance(10);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-flight2", "e1")); // generation 1 sent
    clock.advance(10);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-flight2", "e2")); // generation 2 local
    clock.advance(10);

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-flight2", 1, buildSnapshot("ws-flight2", "e1"), 3)
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.snapshot.name).toBe("e2");
      expect(result.workspace.localGeneration).toBe(2);
      expect(result.workspace.serverRevision).toBe(3);
      expect(result.outbox?.operation).toBe("save");
      expect(result.outbox?.baseRevision).toBe(3);
      expect(result.outbox?.snapshot.name).toBe("e2");
      expect(result.outbox?.queuedAt).toBe(80_010);
    }
  });
});

describe("acknowledgeWorkspaceSync — guards", () => {
  it("rejects an acknowledgement from the future", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-future"));

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-future", 5, buildSnapshot("ws-future"), 1)
    );

    expect(result).toEqual({ ok: false, reason: "stale-generation" });
    expect((await store.getWorkspace("ws-future"))?.syncState).toBe("dirty");
    expect((await store.getOutboxEntry("ws-future"))?.operation).toBe("create");
  });

  it("rejects a server revision that would move backwards", async () => {
    const store = await openTestStore();
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-back"), 5);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-back"));

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-back", 1, buildSnapshot("ws-back"), 5)
    );

    expect(result).toEqual({
      ok: false,
      reason: "stale-server-revision",
      currentRevision: 5,
    });
    const record = await store.getWorkspace("ws-back");
    expect(record?.syncState).toBe("dirty");
    expect(record?.serverRevision).toBe(5);
  });

  it("rejects an acknowledgement for a missing workspace", async () => {
    const store = await openTestStore();

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-none", 1, buildSnapshot("ws-none"), 1)
    );

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects an acknowledgement without a pending outbox", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-clean"));
    await store.acknowledgeWorkspaceSync(ackInput("ws-clean", 1, buildSnapshot("ws-clean"), 1));

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-clean", 1, buildSnapshot("ws-clean"), 2)
    );

    expect(result).toEqual({ ok: false, reason: "no-pending-change" });
    expect((await store.getWorkspace("ws-clean"))?.serverRevision).toBe(1);
  });

  it("rejects a server snapshot whose id differs from the workspace", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-one"));

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-one", 1, buildSnapshot("ws-other"), 1)
    );

    expect(result).toEqual({ ok: false, reason: "workspace-id-mismatch" });
    expect((await store.getWorkspace("ws-one"))?.syncState).toBe("dirty");
  });

  it("rejects an invalid server snapshot and changes nothing", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-badsnap", "Local"));

    const invalid: WorkspaceSnapshot = { ...buildSnapshot("ws-badsnap"), name: "" };
    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-badsnap", 1, invalid, 1)
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid-workspace") {
      expect(result.issues.length).toBeGreaterThan(0);
    } else {
      expect.unreachable("expected invalid-workspace result");
    }
    const record = await store.getWorkspace("ws-badsnap");
    expect(record?.snapshot.name).toBe("Local");
    expect(record?.syncState).toBe("dirty");
  });

  it("throws RangeError for structurally invalid inputs", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-args"));

    await expect(
      store.acknowledgeWorkspaceSync(ackInput("", 1, buildSnapshot("ws-args"), 1))
    ).rejects.toThrow(RangeError);
    await expect(
      store.acknowledgeWorkspaceSync(ackInput("ws-args", 0, buildSnapshot("ws-args"), 1))
    ).rejects.toThrow(RangeError);
    await expect(
      store.acknowledgeWorkspaceSync(ackInput("ws-args", 1, buildSnapshot("ws-args"), 0))
    ).rejects.toThrow(RangeError);
    await expect(
      store.acknowledgeWorkspaceSync(ackInput("ws-args", 1, buildSnapshot("ws-args"), Number.NaN))
    ).rejects.toThrow(RangeError);
  });
});

describe("markWorkspaceConflict", () => {
  async function stageConflictCandidate(
    store: LocalWorkspaceStore,
    clock: { advance(ms: number): void }
  ) {
    await store.hydrateWorkspaceFromServer(buildSnapshot("ws-conflict", "Local Base"), 2);
    clock.advance(10);
    await store.stageWorkspaceUpdate(buildSnapshot("ws-conflict", "Local Edit"));
  }

  it("marks a revision conflict and keeps the local working copy pending", async () => {
    const clock = manualClock(90_000);
    const store = await openTestStore({ now: clock.now });
    await stageConflictCandidate(store, clock);

    const result = await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 7,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.syncState).toBe("conflict");
      expect(result.workspace.conflictRevision).toBe(7);
      expect(result.workspace.serverRevision).toBe(2);
      expect(result.workspace.snapshot.name).toBe("Local Edit");
    }
    const outbox = await store.getOutboxEntry("ws-conflict");
    expect(outbox).toBeDefined();
    expect(outbox?.operation).toBe("save");
    expect(outbox?.baseRevision).toBe(2);
    expect(outbox?.localGeneration).toBe(1);
  });

  it("keeps conflict state and revision while the workspace keeps being edited", async () => {
    const clock = manualClock(90_000);
    const store = await openTestStore({ now: clock.now });
    await stageConflictCandidate(store, clock);
    await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 7,
    });
    clock.advance(10);

    const result = await store.stageWorkspaceUpdate(buildSnapshot("ws-conflict", "Local Edit 2"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.syncState).toBe("conflict");
      expect(result.workspace.conflictRevision).toBe(7);
      expect(result.workspace.localGeneration).toBe(2);
      expect(result.outbox.operation).toBe("save");
      expect(result.outbox.queuedAt).toBe(90_010);
    }
  });

  it("rejects a conflict response that is not newer than the known conflict", async () => {
    const clock = manualClock(90_000);
    const store = await openTestStore({ now: clock.now });
    await stageConflictCandidate(store, clock);
    await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 7,
    });

    const result = await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 7,
    });

    expect(result).toEqual({
      ok: false,
      reason: "stale-server-revision",
      currentRevision: 7,
    });
  });

  it("rejects a conflict response not newer than the committed server revision", async () => {
    const clock = manualClock(90_000);
    const store = await openTestStore({ now: clock.now });
    await stageConflictCandidate(store, clock);

    const result = await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 2,
    });

    expect(result).toEqual({
      ok: false,
      reason: "stale-server-revision",
      currentRevision: 2,
    });
  });

  it("rejects a conflict marking from the future", async () => {
    const clock = manualClock(90_000);
    const store = await openTestStore({ now: clock.now });
    await stageConflictCandidate(store, clock);

    const result = await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 9,
      actualRevision: 7,
    });

    expect(result).toEqual({ ok: false, reason: "stale-generation" });
  });

  it("rejects a conflict marking for a missing workspace", async () => {
    const store = await openTestStore();

    const result = await store.markWorkspaceConflict({
      workspaceId: "ws-none",
      localGeneration: 1,
      actualRevision: 2,
    });

    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects a conflict marking without a pending outbox", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-clean2"));
    await store.acknowledgeWorkspaceSync(ackInput("ws-clean2", 1, buildSnapshot("ws-clean2"), 1));

    const result = await store.markWorkspaceConflict({
      workspaceId: "ws-clean2",
      localGeneration: 1,
      actualRevision: 2,
    });

    expect(result).toEqual({ ok: false, reason: "no-pending-change" });
  });

  it("blocks server hydration of a conflicted working copy", async () => {
    const clock = manualClock(90_000);
    const store = await openTestStore({ now: clock.now });
    await stageConflictCandidate(store, clock);
    await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 7,
    });

    const result = await store.hydrateWorkspaceFromServer(buildSnapshot("ws-conflict"), 9);

    expect(result).toEqual({ ok: false, reason: "local-changes-present" });
    const record = await store.getWorkspace("ws-conflict");
    expect(record?.syncState).toBe("conflict");
  });

  it("rejects an acknowledgement not newer than the conflict revision", async () => {
    const clock = manualClock(90_000);
    const store = await openTestStore({ now: clock.now });
    await stageConflictCandidate(store, clock);
    await store.markWorkspaceConflict({
      workspaceId: "ws-conflict",
      localGeneration: 1,
      actualRevision: 7,
    });

    const result = await store.acknowledgeWorkspaceSync(
      ackInput("ws-conflict", 1, buildSnapshot("ws-conflict"), 7)
    );

    expect(result).toEqual({
      ok: false,
      reason: "stale-server-revision",
      currentRevision: 7,
    });
  });

  it("throws RangeError for structurally invalid conflict inputs", async () => {
    const store = await openTestStore();
    await store.stageWorkspaceCreate(buildSnapshot("ws-cargs"));

    await expect(
      store.markWorkspaceConflict({ workspaceId: " ", localGeneration: 1, actualRevision: 2 })
    ).rejects.toThrow(RangeError);
    await expect(
      store.markWorkspaceConflict({ workspaceId: "ws-cargs", localGeneration: 0, actualRevision: 2 })
    ).rejects.toThrow(RangeError);
    await expect(
      store.markWorkspaceConflict({ workspaceId: "ws-cargs", localGeneration: 1, actualRevision: 0 })
    ).rejects.toThrow(RangeError);
    await expect(
      store.markWorkspaceConflict({
        workspaceId: "ws-cargs",
        localGeneration: 1,
        actualRevision: Number.POSITIVE_INFINITY,
      })
    ).rejects.toThrow(RangeError);
  });
});
