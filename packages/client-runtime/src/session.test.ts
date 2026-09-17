import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkspaceClientRuntime } from "./runtime";
import {
  FakeWorkspaceSyncTransport,
  buildTestSnapshot,
  cleanupTestStores,
  listOk,
  manualClock,
  openTestStore,
  remoteOk,
  renamedSnapshot,
} from "./test-support";

afterEach(async () => {
  await cleanupTestStores();
});

/** Boots a runtime with zero local and zero remote workspaces → empty. */
async function openEmptyRuntime() {
  const store = await openTestStore();
  const fake = new FakeWorkspaceSyncTransport();
  fake.listWorkspacesHandler = () => listOk();
  const runtime = createWorkspaceClientRuntime({ store, transport: fake });
  await runtime.initialize();
  return { store, fake, runtime };
}

/** Boots a runtime that is ready on one clean local copy. */
async function openReadyRuntime() {
  const clock = manualClock(10_000);
  const store = await openTestStore({ now: clock.now });
  const base = buildTestSnapshot("ws-live");
  await store.hydrateWorkspaceFromServer(base, 2);
  const fake = new FakeWorkspaceSyncTransport();
  // Startup reconcile of the clean copy refuses stale pulls by default;
  // tests override per scenario.
  fake.getWorkspaceHandler = () => ({ ok: false, reason: "network-error" });
  const runtime = createWorkspaceClientRuntime({ store, transport: fake });
  return { store, fake, runtime, base, clock };
}

describe("selectWorkspace", () => {
  it("opens an existing local copy and reconciles it", async () => {
    const store = await openTestStore();
    // One clean copy (hydrated) plus one dirty create → selection-required.
    await store.hydrateWorkspaceFromServer(buildTestSnapshot("ws-aaa"), 3);
    await store.stageWorkspaceCreate(buildTestSnapshot("ws-bbb"));
    const fake = new FakeWorkspaceSyncTransport();
    fake.getWorkspaceHandler = () => remoteOk(buildTestSnapshot("ws-aaa", "Server"), 3);
    const runtime = createWorkspaceClientRuntime({ store, transport: fake });
    await runtime.initialize();

    const result = await runtime.selectWorkspace("ws-aaa");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspace.id).toBe("ws-aaa");
      expect(result.workspace.syncState).toBe("clean");
    }
    const snapshot = runtime.getSnapshot();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status === "ready") {
      expect(snapshot.workspace.id).toBe("ws-aaa");
      expect(snapshot.lastRemoteResult).toEqual({
        status: "hydrated",
        workspaceId: "ws-aaa",
        serverRevision: 3,
      });
    }
    expect(fake.getCalls).toEqual(["ws-aaa"]);
  });

  it("hydrates a remote-only workspace into ready", async () => {
    const { fake, runtime } = await openEmptyRuntime();
    const remote = buildTestSnapshot("ws-remote", "Remote Desk");
    fake.getWorkspaceHandler = () => remoteOk(remote, 6);

    const result = await runtime.selectWorkspace("ws-remote");

    expect(result).toEqual({ ok: true, workspace: expect.objectContaining({ id: "ws-remote" }) });
    if (result.ok) {
      expect(result.workspace.snapshot).toEqual(remote);
      expect(result.workspace.serverRevision).toBe(6);
      expect(result.workspace.localGeneration).toBe(0);
    }
    const snapshot = runtime.getSnapshot();
    expect(snapshot.status).toBe("ready");
  });

  it("reports not-found and keeps the previous selection state", async () => {
    const { fake, runtime } = await openEmptyRuntime();
    fake.getWorkspaceHandler = () => ({ ok: false, reason: "not-found" });

    const result = await runtime.selectWorkspace("ws-nowhere");

    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(runtime.getSnapshot()).toEqual({ status: "empty" });
  });

  it("maps pull failures and keeps the previous selection state", async () => {
    const { fake, runtime } = await openEmptyRuntime();
    fake.getWorkspaceHandler = () => ({ ok: false, reason: "network-error" });
    expect(await runtime.selectWorkspace("ws-x")).toEqual({
      ok: false,
      reason: "network-error",
    });
    expect(runtime.getSnapshot()).toEqual({ status: "empty" });

    fake.getWorkspaceHandler = () => ({ ok: false, reason: "server-error", status: 500 });
    expect(await runtime.selectWorkspace("ws-x")).toEqual({
      ok: false,
      reason: "server-error",
      httpStatus: 500,
    });
    expect(runtime.getSnapshot()).toEqual({ status: "empty" });
  });
});

describe("stageWorkspaceCreate", () => {
  it("makes the created workspace the current ready workspace without network", async () => {
    const { fake, runtime } = await openEmptyRuntime();
    const listCallsAfterInit = fake.listCalls.length;
    const created = buildTestSnapshot("ws-new", "Fresh");

    const result = await runtime.stageWorkspaceCreate(created);

    expect(result.ok).toBe(true);
    expect(runtime.getSnapshot()).toEqual({
      status: "ready",
      workspace: expect.objectContaining({
        id: "ws-new",
        syncState: "dirty",
        serverRevision: null,
        localGeneration: 1,
      }),
    });
    expect(fake.createCalls).toHaveLength(0);
    expect(fake.listCalls).toHaveLength(listCallsAfterInit);
  });

  it("switches the current workspace when one is already open", async () => {
    const { runtime } = await openEmptyRuntime();
    await runtime.stageWorkspaceCreate(buildTestSnapshot("ws-first", "First"));

    const result = await runtime.stageWorkspaceCreate(buildTestSnapshot("ws-second", "Second"));

    expect(result.ok).toBe(true);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status === "ready") {
      expect(snapshot.workspace.id).toBe("ws-second");
    }
  });

  it("passes through already-exists and keeps the current state", async () => {
    const { runtime } = await openEmptyRuntime();
    const duplicate = buildTestSnapshot("ws-dup", "Dup");
    await runtime.stageWorkspaceCreate(duplicate);
    const before = runtime.getSnapshot();

    const result = await runtime.stageWorkspaceCreate(duplicate);

    expect(result).toMatchObject({ ok: false, reason: "already-exists" });
    expect(runtime.getSnapshot()).toEqual(before);
  });
});

describe("stageWorkspaceUpdate", () => {
  it("stages the current workspace and reflects the new generation", async () => {
    const { store, fake, runtime, base } = await openReadyRuntime();
    await store.hydrateWorkspaceFromServer(renamedSnapshot(base, "Boot"), 2);
    // Boot the runtime properly (initialize) so the state is ready.
    const state = await runtime.initialize();
    expect(state.status).toBe("ready");

    const edited = renamedSnapshot(base, "Edited");
    const result = await runtime.stageWorkspaceUpdate(edited);

    expect(result.ok).toBe(true);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status === "ready") {
      expect(snapshot.workspace.snapshot).toEqual(edited);
      expect(snapshot.workspace.localGeneration).toBe(1);
      expect(snapshot.workspace.syncState).toBe("dirty");
    }
    expect(fake.saveCalls).toHaveLength(0);
  });

  it("rejects updates with no active workspace", async () => {
    const { runtime } = await openEmptyRuntime();

    const result = await runtime.stageWorkspaceUpdate(buildTestSnapshot("ws-any"));

    expect(result).toEqual({ ok: false, reason: "no-active-workspace" });
  });

  it("rejects updates for a different workspace than the current one", async () => {
    const { runtime } = await openReadyRuntime();
    await runtime.initialize();

    const result = await runtime.stageWorkspaceUpdate(buildTestSnapshot("ws-other", "Other"));

    expect(result).toEqual({ ok: false, reason: "workspace-id-mismatch" });
  });
});

describe("syncCurrent", () => {
  it("reports no-active-workspace without a ready workspace", async () => {
    const { runtime } = await openEmptyRuntime();

    expect(await runtime.syncCurrent()).toEqual({ status: "no-active-workspace" });
  });

  it("never resends an unresolved conflict automatically", async () => {
    const { store, fake, runtime } = await openReadyRuntime();
    await store.stageWorkspaceUpdate(renamedSnapshot(buildTestSnapshot("ws-live"), "Edit"));
    await store.markWorkspaceConflict({ workspaceId: "ws-live", localGeneration: 1, actualRevision: 5 });
    await runtime.initialize();
    const result = await runtime.syncCurrent();

    expect(result).toEqual({ status: "conflict-present", workspaceId: "ws-live" });
    expect(fake.saveCalls).toHaveLength(0);
    expect(fake.getCalls).toHaveLength(0);
  });

  it("syncs a dirty current workspace and reloads the clean record", async () => {
    const clock = manualClock(50_000);
    const { fake, runtime } = await openReadyRuntime();
    await runtime.initialize();
    clock.advance(10);
    await runtime.stageWorkspaceUpdate(renamedSnapshot(buildTestSnapshot("ws-live"), "Edited"));
    fake.saveWorkspaceHandler = (snapshot) => ({
      ok: true,
      workspace: { snapshot, revision: 3 },
    });

    const result = await runtime.syncCurrent();

    expect(result).toEqual({ status: "synced", workspaceId: "ws-live", serverRevision: 3 });
    const snapshot = runtime.getSnapshot();
    if (snapshot.status === "ready") {
      expect(snapshot.workspace.syncState).toBe("clean");
      expect(snapshot.workspace.serverRevision).toBe(3);
      expect(snapshot.lastRemoteResult).toEqual(result);
    }
  });
});

describe("pullCurrent", () => {
  it("reports no-active-workspace without a ready workspace", async () => {
    const { runtime } = await openEmptyRuntime();

    expect(await runtime.pullCurrent()).toEqual({ status: "no-active-workspace" });
  });

  it("pulls the current workspace and never GETs when changes are present", async () => {
    const { fake, runtime } = await openReadyRuntime();
    await runtime.initialize();
    await runtime.stageWorkspaceUpdate(renamedSnapshot(buildTestSnapshot("ws-live"), "Dirty"));
    const getCallsBefore = fake.getCalls.length;

    const result = await runtime.pullCurrent();

    expect(result).toEqual({ status: "local-changes-present", workspaceId: "ws-live" });
    expect(fake.getCalls).toHaveLength(getCallsBefore);
    const snapshot = runtime.getSnapshot();
    if (snapshot.status === "ready") {
      expect(snapshot.workspace.syncState).toBe("dirty");
      expect(snapshot.lastRemoteResult).toEqual(result);
    }
  });

  it("refreshes the ready workspace from a newer remote", async () => {
    const { fake, runtime } = await openReadyRuntime();
    await runtime.initialize();
    fake.getWorkspaceHandler = () =>
      remoteOk(buildTestSnapshot("ws-live", "Server Newer"), 7);

    const result = await runtime.pullCurrent();

    expect(result).toEqual({ status: "hydrated", workspaceId: "ws-live", serverRevision: 7 });
    const snapshot = runtime.getSnapshot();
    if (snapshot.status === "ready") {
      expect(snapshot.workspace.snapshot.name).toBe("Server Newer");
      expect(snapshot.workspace.serverRevision).toBe(7);
    }
  });
});

describe("subscribe and close", () => {
  it("notifies subscribers on state replacement and stops after unsubscribe", async () => {
    const { fake, runtime } = await openEmptyRuntime();
    fake.getWorkspaceHandler = () => remoteOk(buildTestSnapshot("ws-sub"), 1);
    const seen: string[] = [];
    const unsubscribe = runtime.subscribe(() => seen.push(runtime.getSnapshot().status));

    await runtime.selectWorkspace("ws-sub");
    // A selection notifies at least once and only ever through
    // whole-state replacement of ready states.
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((status) => status === "ready")).toBe(true);
    const notificationsAfterSelect = seen.length;

    unsubscribe();
    await runtime.selectWorkspace("ws-sub");
    expect(seen.length).toBe(notificationsAfterSelect);
  });

  it("rejects mutations and initialize after close and clears listeners", async () => {
    const { store, runtime } = await openEmptyRuntime();
    const listener = vi.fn();
    runtime.subscribe(listener);

    runtime.close();

    expect(() => runtime.initialize()).toThrow("workspace client runtime is closed");
    await expect(runtime.selectWorkspace("ws-any")).rejects.toThrow(
      "workspace client runtime is closed",
    );
    await expect(runtime.stageWorkspaceCreate(buildTestSnapshot("ws-c"))).rejects.toThrow(
      "workspace client runtime is closed",
    );
    await expect(runtime.stageWorkspaceUpdate(buildTestSnapshot("ws-c"))).rejects.toThrow(
      "workspace client runtime is closed",
    );
    await expect(runtime.syncCurrent()).rejects.toThrow("workspace client runtime is closed");
    await expect(runtime.pullCurrent()).rejects.toThrow("workspace client runtime is closed");
    expect(listener).not.toHaveBeenCalled();
    // The underlying store is closed too.
    await expect(store.listWorkspaces()).rejects.toThrow();
  });
});
