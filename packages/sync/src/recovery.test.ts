import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";

import {
  FakeWorkspaceSyncTransport,
  buildTestSnapshot,
  cleanupTestStores,
  deferred,
  openTestStore,
  renamedSnapshot,
} from "./test-support";
import { createWorkspaceSyncCoordinator } from "./coordinator";

afterEach(async () => {
  await cleanupTestStores();
});

function remoteOk(snapshot: WorkspaceSnapshot, revision: number) {
  return { ok: true as const, workspace: { snapshot, revision } };
}

describe("ambiguous CREATE success recovery (POST 409 already-exists)", () => {
  it("recovers a lost response when the remote equals the sent snapshot", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-amb", "Local Name");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "already-exists" });
    fake.getWorkspaceHandler = () => remoteOk(local, 1);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-amb");

    expect(result).toEqual({ status: "synced", workspaceId: "ws-amb", serverRevision: 1 });
    expect(fake.createCalls).toHaveLength(1);
    expect(fake.getCalls).toEqual(["ws-amb"]);
    const record = await store.getWorkspace("ws-amb");
    expect(record?.syncState).toBe("clean");
    expect(record?.serverRevision).toBe(1);
    expect(await store.getOutboxEntry("ws-amb")).toBeUndefined();
  });

  it("recovers as pending when a newer local edit accumulated before the GET", async () => {
    const store = await openTestStore();
    const v1 = buildTestSnapshot("ws-amb2", "v1");
    await store.stageWorkspaceCreate(v1); // generation 1 sent
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "already-exists" });
    const gate = deferred<{ ok: true; workspace: { snapshot: WorkspaceSnapshot; revision: number } }>();
    fake.getWorkspaceHandler = () => gate.promise;
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });
    const syncPromise = coordinator.syncWorkspace("ws-amb2");
    await vi.waitFor(() => expect(fake.getCalls).toHaveLength(1));

    const v2 = renamedSnapshot(v1, "v2");
    await store.stageWorkspaceUpdate(v2); // generation 2 while recovering

    gate.resolve({ ok: true, workspace: { snapshot: v1, revision: 1 } });
    const result = await syncPromise;

    expect(result).toEqual({ status: "pending", workspaceId: "ws-amb2", serverRevision: 1 });
    const record = await store.getWorkspace("ws-amb2");
    expect(record?.snapshot).toEqual(v2);
    expect(record?.serverRevision).toBe(1);
    const outbox = await store.getOutboxEntry("ws-amb2");
    expect(outbox?.operation).toBe("save");
    expect(outbox?.baseRevision).toBe(1);
  });

  it("marks a real conflict when the remote snapshot differs", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-cc", "Local Name");
    await store.stageWorkspaceCreate(local);
    const remote = renamedSnapshot(local, "Server Name");
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "already-exists" });
    fake.getWorkspaceHandler = () => remoteOk(remote, 5);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-cc");

    expect(result).toEqual({ status: "conflict", workspaceId: "ws-cc", actualRevision: 5 });
    const record = await store.getWorkspace("ws-cc");
    expect(record?.snapshot).toEqual(local);
    expect(record?.syncState).toBe("conflict");
    expect(record?.conflictRevision).toBe(5);
    const outbox = await store.getOutboxEntry("ws-cc");
    expect(outbox?.operation).toBe("create");
    expect(outbox?.snapshot).toEqual(local);
  });

  it("keeps the dirty create outbox when the recovery GET fails with network-error", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-amb3");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "already-exists" });
    fake.getWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "network-error" });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-amb3");

    expect(result).toEqual({ status: "network-error", workspaceId: "ws-amb3" });
    const outbox = await store.getOutboxEntry("ws-amb3");
    expect(outbox?.operation).toBe("create");
    expect((await store.getWorkspace("ws-amb3"))?.syncState).toBe("dirty");
  });

  it("maps recovery GET server-error and protocol-error failures", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-amb4");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "already-exists" });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    fake.getWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "server-error", status: 502 });
    expect(await coordinator.syncWorkspace("ws-amb4")).toEqual({
      status: "server-error",
      workspaceId: "ws-amb4",
      httpStatus: 502,
    });

    fake.getWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "protocol-error", status: 200 });
    expect(await coordinator.syncWorkspace("ws-amb4")).toEqual({
      status: "protocol-error",
      workspaceId: "ws-amb4",
      httpStatus: 200,
    });

    expect(await store.getOutboxEntry("ws-amb4")).toBeDefined();
  });

  it("treats a recovery GET not-found as server-missing without guessing a revision", async () => {
    const store = await openTestStore();
    const local = buildTestSnapshot("ws-amb5");
    await store.stageWorkspaceCreate(local);
    const fake = new FakeWorkspaceSyncTransport();
    fake.createWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "already-exists" });
    fake.getWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "not-found" });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-amb5");

    // POST said the workspace exists, GET says it does not: contradictory
    // server state. No conflict revision can be trusted here, so the dirty
    // create outbox is preserved untouched.
    expect(result).toEqual({ status: "server-missing", workspaceId: "ws-amb5" });
    expect(await store.getOutboxEntry("ws-amb5")).toBeDefined();
    expect((await store.getWorkspace("ws-amb5"))?.syncState).toBe("dirty");
  });
});

describe("ambiguous SAVE success recovery (PUT 409 revision-conflict)", () => {
  it("recovers a lost response when the remote equals the sent snapshot", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-sr");
    await store.hydrateWorkspaceFromServer(base, 2);
    const e1 = renamedSnapshot(base, "e1");
    await store.stageWorkspaceUpdate(e1);
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "revision-conflict", actualRevision: 3 });
    fake.getWorkspaceHandler = () => remoteOk(e1, 3);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-sr");

    expect(result).toEqual({ status: "synced", workspaceId: "ws-sr", serverRevision: 3 });
    const record = await store.getWorkspace("ws-sr");
    expect(record?.syncState).toBe("clean");
    expect(record?.serverRevision).toBe(3);
    expect(await store.getOutboxEntry("ws-sr")).toBeUndefined();
  });

  it("acknowledges the higher current revision when the remote snapshot still matches", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-sr2");
    await store.hydrateWorkspaceFromServer(base, 2);
    const e1 = renamedSnapshot(base, "e1");
    await store.stageWorkspaceUpdate(e1);
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "revision-conflict", actualRevision: 3 });
    // Remote has moved to revision 4 since our write, but the snapshot is
    // exactly the business state we wanted — revision 4 is the success.
    fake.getWorkspaceHandler = () => remoteOk(e1, 4);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-sr2");

    expect(result).toEqual({ status: "synced", workspaceId: "ws-sr2", serverRevision: 4 });
    expect((await store.getWorkspace("ws-sr2"))?.serverRevision).toBe(4);
  });

  it("marks a real conflict at the remote current revision when snapshots differ", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-sr3");
    await store.hydrateWorkspaceFromServer(base, 2);
    const e1 = renamedSnapshot(base, "e1");
    await store.stageWorkspaceUpdate(e1);
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "revision-conflict", actualRevision: 3 });
    fake.getWorkspaceHandler = () => remoteOk(renamedSnapshot(base, "Server Edit"), 6);
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    const result = await coordinator.syncWorkspace("ws-sr3");

    // The GET may see a newer revision than the original 409: use it.
    expect(result).toEqual({ status: "conflict", workspaceId: "ws-sr3", actualRevision: 6 });
    const record = await store.getWorkspace("ws-sr3");
    expect(record?.snapshot).toEqual(e1);
    expect(record?.syncState).toBe("conflict");
    expect(record?.conflictRevision).toBe(6);
    expect(await store.getOutboxEntry("ws-sr3")).toBeDefined();
  });

  it("falls back to the 409 actualRevision when the recovery GET fails", async () => {
    const store = await openTestStore();
    const base = buildTestSnapshot("ws-sr4");
    await store.hydrateWorkspaceFromServer(base, 2);
    const e1 = renamedSnapshot(base, "e1");
    await store.stageWorkspaceUpdate(e1);
    const fake = new FakeWorkspaceSyncTransport();
    fake.saveWorkspaceHandler = () =>
      Promise.resolve({ ok: false, reason: "revision-conflict", actualRevision: 3 });
    const coordinator = createWorkspaceSyncCoordinator({ store, transport: fake });

    fake.getWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "network-error" });
    expect(await coordinator.syncWorkspace("ws-sr4")).toEqual({
      status: "conflict",
      workspaceId: "ws-sr4",
      actualRevision: 3,
    });
    expect((await store.getWorkspace("ws-sr4"))?.conflictRevision).toBe(3);

    fake.getWorkspaceHandler = () => Promise.resolve({ ok: false, reason: "not-found" });
    // The conflict at revision 3 is already recorded; re-marking the same
    // revision is a no-op the store reports as superseded — the local
    // snapshot, conflict revision and outbox all stay intact.
    expect(await coordinator.syncWorkspace("ws-sr4")).toEqual({
      status: "superseded",
      workspaceId: "ws-sr4",
    });
    const record = await store.getWorkspace("ws-sr4");
    expect(record?.syncState).toBe("conflict");
    expect(record?.conflictRevision).toBe(3);
    expect(await store.getOutboxEntry("ws-sr4")).toBeDefined();
  });
});
