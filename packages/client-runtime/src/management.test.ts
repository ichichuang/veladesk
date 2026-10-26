import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import type { WorkspaceSyncTransport, SaveRemoteWorkspaceResult, DeleteRemoteWorkspaceResult } from "@veladesk/sync";
import { createWorkspaceClientRuntime } from "./runtime";
import { LAST_WORKSPACE_KEY } from "./selection-memory";
import { buildTestSnapshot, openTestStore, cleanupTestStores, deferred } from "./test-support";

afterEach(cleanupTestStores);
function preferences(last?: string) {
  const values = new Map<string, string>(last === undefined ? [] : [[LAST_WORKSPACE_KEY, last]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function remote(snapshots: readonly WorkspaceSnapshot[]) {
  const records = new Map(snapshots.map(snapshot => [snapshot.id, { snapshot, revision: 1 }]));
  const transport = {
    listWorkspaces: vi.fn(async () => ({ ok: true as const, workspaces: [...records.values()].map(record => ({ id: record.snapshot.id, name: record.snapshot.name, revision: record.revision })) })),
    getWorkspace: vi.fn(async (id: string) => { const workspace = records.get(id); return workspace === undefined ? { ok: false as const, reason: "not-found" as const } : { ok: true as const, workspace }; }),
    createWorkspace: vi.fn(async (snapshot: WorkspaceSnapshot) => {
      const workspace = { snapshot, revision: 1 }; records.set(snapshot.id, workspace); return { ok: true as const, workspace };
    }),
    saveWorkspace: vi.fn(async (snapshot: WorkspaceSnapshot, expectedRevision: number): Promise<SaveRemoteWorkspaceResult> => {
      const workspace = { snapshot, revision: expectedRevision + 1 }; records.set(snapshot.id, workspace); return { ok: true, workspace };
    }),
    renameWorkspace: vi.fn(async (id: string, name: string, expectedRevision: number) => {
      const workspace = { snapshot: { ...records.get(id)!.snapshot, name }, revision: expectedRevision + 1 }; records.set(id, workspace); return { ok: true as const, workspace };
    }),
    deleteWorkspace: vi.fn(async (id: string, _revision: number): Promise<DeleteRemoteWorkspaceResult> => { records.delete(id); return { ok: true as const }; }),
  } satisfies WorkspaceSyncTransport;
  return { records, transport };
}
async function setup(last = "work") {
  const snapshots = ["work", "home", "other"].map(id => buildTestSnapshot(id, id));
  const store = await openTestStore();
  for (const snapshot of snapshots) await store.hydrateWorkspaceFromServer(snapshot, 1);
  const { records, transport } = remote(snapshots);
  const storage = preferences(last);
  const runtime = createWorkspaceClientRuntime({ store, transport, preferenceStorage: storage });
  await runtime.initialize();
  return { store, transport, records, storage, runtime, snapshots };
}

describe("ready workspace management", () => {
  it("remembers the last workspace and restores it without the picker", async () => {
    const { runtime, storage, store, transport } = await setup();
    expect(runtime.getSnapshot()).toMatchObject({ status: "ready", workspace: { id: "work" } });
    expect(await runtime.selectWorkspace("home")).toMatchObject({ ok: true });
    expect(storage.getItem(LAST_WORKSPACE_KEY)).toBe("home");
    const restarted = createWorkspaceClientRuntime({ store, transport, preferenceStorage: storage });
    expect(await restarted.initialize()).toMatchObject({ status: "ready", workspace: { id: "home" } });
  });
  it("keeps selection-required when the stored id is absent", async () => {
    const { runtime } = await setup("deleted");
    expect(runtime.getSnapshot().status).toBe("selection-required");
  });
  it("restores a remembered remote-only workspace", async () => {
    const store = await openTestStore(); const { transport } = remote([buildTestSnapshot("work"), buildTestSnapshot("home")]);
    const runtime = createWorkspaceClientRuntime({ store, transport, preferenceStorage: preferences("home") });
    expect(await runtime.initialize()).toMatchObject({ status: "ready", workspace: { id: "home" } });
  });
  it("tolerates unavailable preference storage and remains usable without window", async () => {
    const store = await openTestStore(); await store.hydrateWorkspaceFromServer(buildTestSnapshot("work"), 1);
    const { transport } = remote([buildTestSnapshot("work")]);
    const storage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    const runtime = createWorkspaceClientRuntime({ store, transport, preferenceStorage: storage });
    expect(await runtime.initialize()).toMatchObject({ status: "ready" });
    expect(await createWorkspaceClientRuntime({ store, transport, preferenceStorage: null }).initialize()).toMatchObject({ status: "ready" });
  });
  it("waits for an in-flight save before switching and never lets its result switch back", async () => {
    const { runtime, transport, snapshots, store } = await setup();
    const edited = { ...snapshots[0]!, name: "Edited" };
    await runtime.stageWorkspaceUpdate(edited);
    const gate = deferred<SaveRemoteWorkspaceResult>();
    transport.saveWorkspace.mockImplementationOnce(() => gate.promise);
    const save = runtime.syncCurrent();
    await vi.waitFor(() => expect(transport.saveWorkspace).toHaveBeenCalledOnce());
    const switched = runtime.selectWorkspace("home");
    await Promise.resolve();
    expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "work" } });
    gate.resolve({ ok: true, workspace: { snapshot: edited, revision: 2 } });
    await save;
    expect(await switched).toMatchObject({ ok: true });
    expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "home" } });
    expect((await store.getWorkspace("work"))?.snapshot.name).toBe("Edited");
    expect(transport.saveWorkspace).toHaveBeenCalledOnce();
  });
  it("flushes an already-started local stage and a queued newer generation", async () => {
    const { runtime, snapshots, store } = await setup();
    const pending = runtime.stageWorkspaceUpdate({ ...snapshots[0]!, name: "Pending" });
    const switched = runtime.selectWorkspace("home");
    expect(await pending).toMatchObject({ ok: true }); expect(await switched).toMatchObject({ ok: true });
    expect((await store.getWorkspace("work"))?.syncState).toBe("clean");
  });
  it("flushes newer edits accumulated during an in-flight save before switching", async () => {
    const { runtime, transport, snapshots, store } = await setup();
    const first = { ...snapshots[0]!, name: "First" }, newer = { ...snapshots[0]!, name: "Newer" };
    await runtime.stageWorkspaceUpdate(first);
    const gate = deferred<SaveRemoteWorkspaceResult>();
    transport.saveWorkspace.mockImplementationOnce(() => gate.promise);
    const saving = runtime.syncCurrent();
    await vi.waitFor(() => expect(transport.saveWorkspace).toHaveBeenCalledOnce());
    await runtime.stageWorkspaceUpdate(newer);
    const switching = runtime.selectWorkspace("home");
    gate.resolve({ ok: true, workspace: { snapshot: first, revision: 2 } });
    await saving;
    expect(await switching).toMatchObject({ ok: true });
    expect(transport.saveWorkspace).toHaveBeenLastCalledWith(newer, 2);
    expect(await store.getWorkspace("work")).toMatchObject({ snapshot: { name: "Newer" }, serverRevision: 3, syncState: "clean" });
  });
  it("blocks an unresolved conflict without sending it or discarding its outbox", async () => {
    const { runtime, store, snapshots, transport } = await setup();
    await runtime.stageWorkspaceUpdate({ ...snapshots[0]!, name: "Local" });
    await store.markWorkspaceConflict({ workspaceId: "work", localGeneration: 1, actualRevision: 2 });
    expect(await runtime.selectWorkspace("home")).toMatchObject({ ok: false, reason: "unsaved-changes" });
    expect(transport.saveWorkspace).not.toHaveBeenCalled();
    expect(await store.getOutboxEntry("work")).toMatchObject({ snapshot: { name: "Local" } });
  });
  it("blocks switching on sync failure, preserving local edits and last selection", async () => {
    const { runtime, snapshots, transport, storage, store } = await setup();
    await runtime.stageWorkspaceUpdate({ ...snapshots[0]!, name: "Offline edit" });
    transport.saveWorkspace.mockResolvedValueOnce({ ok: false, reason: "network-error" });
    expect(await runtime.selectWorkspace("home")).toEqual({ ok: false, reason: "unsaved-changes" });
    expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "work" } });
    expect(storage.getItem(LAST_WORKSPACE_KEY)).toBe("work"); expect(await store.getOutboxEntry("work")).toBeDefined();
  });
  it("honors UI edit guards and refuses overlapping switches", async () => {
    const { runtime } = await setup(); const gate = deferred<string | null>();
    const unregister = runtime.registerBeforeWorkspaceChange(() => gate.promise);
    const switching = runtime.selectWorkspace("home");
    expect(await runtime.selectWorkspace("other")).toEqual({ ok: false, reason: "busy" });
    gate.resolve("Finish the edit first");
    expect(await switching).toEqual({ ok: false, reason: "unsaved-changes", message: "Finish the edit first" });
    unregister(); expect(await runtime.selectWorkspace("home")).toMatchObject({ ok: true });
  });
  it("creates a server-backed local copy and makes it active", async () => {
    const { runtime, store } = await setup();
    expect(await runtime.createWorkspace(buildTestSnapshot("new", "New"))).toEqual({ ok: true });
    expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "new", syncState: "clean" } });
    expect(await store.getOutboxEntry("new")).toBeUndefined();
  });
  it("renames the remote and local copy without an orphan outbox", async () => {
    const { runtime, store, records } = await setup();
    expect(await runtime.renameWorkspace("home", "House")).toEqual({ ok: true });
    expect(records.get("home")?.snapshot.name).toBe("House"); expect((await store.getWorkspace("home"))?.snapshot.name).toBe("House");
    expect(await store.getOutboxEntry("home")).toBeUndefined(); expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "work" } });
  });
  it("validates empty, long and duplicate names before mutation", async () => {
    const { runtime, transport } = await setup();
    expect(await runtime.renameWorkspace("work", " ")).toEqual({ ok: false, reason: "invalid-name" });
    expect(await runtime.renameWorkspace("work", "x".repeat(41))).toEqual({ ok: false, reason: "invalid-name" });
    expect(await runtime.renameWorkspace("work", "home")).toEqual({ ok: false, reason: "name-conflict" });
    expect(transport.renameWorkspace).not.toHaveBeenCalled();
  });
  it("deletes the current workspace and selects the most recently used remaining one", async () => {
    const { runtime, store, records, storage } = await setup();
    await runtime.selectWorkspace("other"); await runtime.selectWorkspace("home");
    expect(await runtime.deleteWorkspace("home")).toEqual({ ok: true });
    expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "other" } });
    expect(storage.getItem(LAST_WORKSPACE_KEY)).toBe("other");
    expect(await store.getWorkspace("home")).toBeUndefined(); expect(await store.getOutboxEntry("home")).toBeUndefined(); expect(records.has("home")).toBe(false);
    expect((await runtime.listWorkspaces()).map(candidate => candidate.id)).toEqual(["other", "work"]);
  });
  it("deleting another workspace keeps the active session", async () => {
    const { runtime } = await setup(); expect(await runtime.deleteWorkspace("home")).toEqual({ ok: true });
    expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "work" } });
  });
  it("does not remove local data when server deletion fails", async () => {
    const { runtime, store, transport } = await setup();
    transport.deleteWorkspace.mockResolvedValueOnce({ ok: false, reason: "network-error" });
    expect(await runtime.deleteWorkspace("work")).toMatchObject({ ok: false, reason: "network-error" }); expect(await store.getWorkspace("work")).toBeDefined();
    expect(runtime.getSnapshot()).toMatchObject({ workspace: { id: "work" } });
  });
  it("refuses deletion of the last workspace and creation past ten", async () => {
    const { runtime, store, transport } = await setup();
    await runtime.deleteWorkspace("home"); await runtime.deleteWorkspace("other");
    expect(await runtime.deleteWorkspace("work")).toEqual({ ok: false, reason: "last-workspace" });
    for (let i = 0; i < 9; i++) await store.hydrateWorkspaceFromServer(buildTestSnapshot(`extra-${i}`, `Extra ${i}`), 1);
    expect(await runtime.createWorkspace(buildTestSnapshot("overflow"))).toEqual({ ok: false, reason: "workspace-limit" }); expect(transport.createWorkspace).not.toHaveBeenCalled();
  });
});
