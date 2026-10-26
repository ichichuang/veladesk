import { createSelectionMemory } from "./selection-memory";
import { createWorkspaceSyncCoordinator } from "@veladesk/sync";
import type {
  ListRemoteWorkspacesResult,
  PullWorkspaceResult,
  SyncWorkspaceResult,
} from "@veladesk/sync";
import type {
  LocalWorkspaceRecord,
  StageWorkspaceCreateResult,
} from "@veladesk/local-store";
import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";

import type {
  WorkspaceCandidate,
  WorkspaceManagementResult,
  RuntimeStageWorkspaceUpdateResult,
  RuntimeSyncCurrentResult,
  SelectWorkspaceResult,
  WorkspaceClientRuntime,
  WorkspaceClientRuntimeOptions,
  WorkspaceClientRuntimeState,
  WorkspaceRuntimeRemoteResult,
} from "./types";

/**
 * Browser workspace session runtime.
 *
 * Bootstrap is local-first: a single local working copy opens immediately
 * and reconciles in the background; multiple local copies restore a valid
 * remembered selection or ask the user to choose; only an
 * empty local store consults the remote catalog. Once a local workspace is
 * open, network failures degrade to `lastRemoteResult` — the desktop stays
 * usable offline and never masquerades as `remote-unavailable`.
 *
 * Editing never sends network traffic by itself: staging only touches the
 * local working copy, and `syncCurrent`/`pullCurrent` are the explicit
 * remote actions. Unresolved conflicts are never re-sent automatically.
 */
export function createWorkspaceClientRuntime(
  options: WorkspaceClientRuntimeOptions
): WorkspaceClientRuntime {
  const { store, transport } = options;
  const memory = createSelectionMemory(options.preferenceStorage);
  let changing = false;
  let editsBlocked = false;
  const beforeChange = new Set<() => Promise<string | null>>();
  const pendingWrites = new Set<Promise<unknown>>();
  const coordinator = createWorkspaceSyncCoordinator({ store, transport });

  let state: WorkspaceClientRuntimeState = { status: "idle" };
  let closed = false;
  let initializationPromise: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  function assertOpen(): void {
    if (closed) {
      throw new Error("workspace client runtime is closed");
    }
  }

  function setState(next: WorkspaceClientRuntimeState): void {
    if (closed) return;
    if (next.status === "ready") memory.remember(next.workspace.id);
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function getSnapshot(): WorkspaceClientRuntimeState {
    return state;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function initialize(): Promise<WorkspaceClientRuntimeState> {
    assertOpen();
    if (initializationPromise === undefined) {
      initializationPromise = runInitialize();
    }
    // Single-flight: concurrent and later calls ride the same run and read
    // the settled state — the bootstrap itself never executes twice.
    return initializationPromise.then(() => state);
  }

  async function runInitialize(): Promise<void> {
    setState({ status: "booting" });

    // Local IndexedDB failures intentionally propagate: real storage
    // corruption must reject, not masquerade as remote-unavailable.
    const locals = await store.listWorkspaces();

    if (locals.length === 1) {
      await openAndReconcile(locals[0]!);
      return;
    }
    if (locals.length > 1) {
      const last = locals.find(record => record.id === memory.last());
      if (last !== undefined) { await openAndReconcile(last); return; }
      // A stale or absent preference keeps the existing explicit picker.
      // Local-first bootstrap never waits for the remote catalog here.
      setState({
        status: "selection-required",
        candidates: locals.map(localCandidate),
      });
      return;
    }

    const remote = await transport.listWorkspaces();
    if (!remote.ok) {
      setState(remoteUnavailableState(remote));
      return;
    }
    if (remote.workspaces.length === 0) {
      setState({ status: "empty" });
      return;
    }
    const remembered = remote.workspaces.find(workspace => workspace.id === memory.last());
    if (remote.workspaces.length === 1 || remembered !== undefined) {
      const only = remembered ?? remote.workspaces[0]!;
      const pulled = await coordinator.pullWorkspace(only.id);
      const record = await store.getWorkspace(only.id);
      if (record !== undefined) {
        // Local-first resolution: hydrated, or the workspace landed in the
        // local store concurrently (stale/local-changes pull refusals).
        setState({ status: "ready", workspace: record, lastRemoteResult: pulled });
        return;
      }
      if (pulled.status === "hydrated") {
        throw new Error(
          `internal invariant violated: hydrated workspace ${only.id} is missing from the local store`
        );
      }
      // The remote has exactly one workspace but it could not be
      // materialized locally — report why the session cannot start.
      setState(remotePullUnavailableState(pulled));
      return;
    }
    setState({
      status: "selection-required",
      candidates: remote.workspaces.map((summary) => ({
        source: "remote",
        id: summary.id,
        name: summary.name,
        revision: summary.revision,
      })),
    });
  }

  async function selectWorkspace(workspaceId: WorkspaceId): Promise<SelectWorkspaceResult> {
    assertOpen();
    if (changing) return { ok: false, reason: "busy" };
    if (state.status === "ready" && state.workspace.id === workspaceId) return { ok: true, workspace: state.workspace };
    changing = true;
    try {
      const blocked = await flushBeforeChange();
      if (blocked !== null) return blocked;
      return await openSelected(workspaceId);
    } finally { changing = false; editsBlocked = false; }
  }

  async function openSelected(workspaceId: WorkspaceId): Promise<SelectWorkspaceResult> {
    const local = await store.getWorkspace(workspaceId);
    if (local !== undefined) {
      setState({ status: "ready", workspace: local });
      editsBlocked = false;
      const remoteResult = await reconcileOnce(workspaceId);
      const record = await refreshReadyState(workspaceId, remoteResult);
      return { ok: true, workspace: record };
    }
    const pulled = await coordinator.pullWorkspace(workspaceId);
    if (
      pulled.status === "hydrated" ||
      pulled.status === "local-changes-present" ||
      pulled.status === "stale-server-revision"
    ) {
      // All three outcomes imply (or just created) a local record.
      const record = await store.getWorkspace(workspaceId);
      if (record === undefined) {
        throw new Error(
          `internal invariant violated: pull reported ${pulled.status} with no local record for ${workspaceId}`
        );
      }
      setState({ status: "ready", workspace: record });
      editsBlocked = false;
      const opened = await refreshReadyState(workspaceId, pulled);
      return { ok: true, workspace: opened };
    }
    switch (pulled.status) {
      case "not-found":
        return { ok: false, reason: "not-found" };
      case "network-error":
        return { ok: false, reason: "network-error" };
      case "server-error":
        return { ok: false, reason: "server-error", httpStatus: pulled.httpStatus };
      case "protocol-error":
        return pulled.httpStatus === undefined
          ? { ok: false, reason: "protocol-error" }
          : { ok: false, reason: "protocol-error", httpStatus: pulled.httpStatus };
    }
  }

  async function stageWorkspaceCreate(
    snapshot: WorkspaceSnapshot
  ): Promise<StageWorkspaceCreateResult> {
    assertOpen();
    const result = await store.stageWorkspaceCreate(snapshot);
    if (result.ok) {
      // Local-first creation: instantly usable, no network, and no
      // inherited remote result from a previously selected workspace.
      setState({ status: "ready", workspace: result.workspace });
    }
    return result;
  }

  async function stageWorkspaceUpdate(snapshot: WorkspaceSnapshot): Promise<RuntimeStageWorkspaceUpdateResult> {
    assertOpen();
    if (editsBlocked) return { ok: false, reason: "busy" };
    const pending = runStageWorkspaceUpdate(snapshot);
    pendingWrites.add(pending);
    void pending.finally(() => pendingWrites.delete(pending)).catch(() => {});
    return pending;
  }

  async function runStageWorkspaceUpdate(
    snapshot: WorkspaceSnapshot
  ): Promise<RuntimeStageWorkspaceUpdateResult> {
    assertOpen();
    const current = state;
    if (current.status !== "ready") {
      return { ok: false, reason: "no-active-workspace" };
    }
    if (snapshot.id !== current.workspace.id) {
      return { ok: false, reason: "workspace-id-mismatch" };
    }
    const result = await store.stageWorkspaceUpdate(snapshot);
    if (result.ok && state.status === "ready" && state.workspace.id === snapshot.id) {
      setState({
        status: "ready",
        workspace: result.workspace,
        ...(current.lastRemoteResult !== undefined
          ? { lastRemoteResult: current.lastRemoteResult }
          : {}),
      });
    }
    return result;
  }

  async function syncCurrent(): Promise<RuntimeSyncCurrentResult> {
    assertOpen();
    const current = state;
    if (current.status !== "ready") {
      return { status: "no-active-workspace" };
    }
    const workspaceId = current.workspace.id;
    if (current.workspace.syncState === "conflict") {
      // An unresolved conflict is never silently re-sent.
      return { status: "conflict-present", workspaceId };
    }
    const remoteResult: SyncWorkspaceResult = await coordinator.syncWorkspace(workspaceId);
    await refreshReadyState(workspaceId, remoteResult);
    return remoteResult;
  }

  async function pullCurrent(): Promise<RuntimeSyncCurrentResult> {
    assertOpen();
    const current = state;
    if (current.status !== "ready") {
      return { status: "no-active-workspace" };
    }
    const workspaceId = current.workspace.id;
    const remoteResult: PullWorkspaceResult = await coordinator.pullWorkspace(workspaceId);
    await refreshReadyState(workspaceId, remoteResult);
    return remoteResult;
  }


  function registerBeforeWorkspaceChange(guard: () => Promise<string | null>): () => void {
    assertOpen();
    beforeChange.add(guard);
    return () => { beforeChange.delete(guard); };
  }

  async function listWorkspaces(): Promise<readonly WorkspaceCandidate[]> {
    assertOpen();
    const local = await store.listWorkspaces();
    const remote = await transport.listWorkspaces();
    const candidates = new Map<string, WorkspaceCandidate>();
    if (remote.ok) for (const item of remote.workspaces) candidates.set(item.id, { source: "remote", ...item });
    for (const item of local) candidates.set(item.id, localCandidate(item));
    const recent = memory.recent();
    return [...candidates.values()].sort((a, b) => {
      const ai = recent.indexOf(a.id), bi = recent.indexOf(b.id);
      return (ai < 0 ? 10 : ai) - (bi < 0 ? 10 : bi) || a.id.localeCompare(b.id);
    });
  }

  async function flushWorkspace(id: string): Promise<boolean> {
    await Promise.all([...pendingWrites]);
    // coordinator single-flight also waits for an already-running save.
    for (let attempt = 0; attempt < 10; attempt++) {
      const record = await store.getWorkspace(id);
      if (record === undefined) return true;
      if (record.syncState === "conflict") return false;
      const result = await coordinator.syncWorkspace(id);
      if (!["idle", "synced", "pending"].includes(result.status)) return false;
      const latest = await store.getWorkspace(id);
      if (latest?.syncState === "clean") {
        await refreshReadyState(id, result);
        return true;
      }
    }
    return false;
  }

  async function flushBeforeChange(): Promise<Extract<SelectWorkspaceResult, { ok: false }> | null> {
    for (const guard of beforeChange) {
      const message = await guard();
      if (message !== null) return { ok: false, reason: "unsaved-changes", message };
    }
    editsBlocked = true;
    if (state.status === "ready" && !(await flushWorkspace(state.workspace.id))) {
      return { ok: false, reason: "unsaved-changes" };
    }
    return null;
  }

  async function manage(operation: () => Promise<WorkspaceManagementResult>): Promise<WorkspaceManagementResult> {
    assertOpen();
    if (changing) return { ok: false, reason: "busy" };
    changing = true;
    try {
      const blocked = await flushBeforeChange();
      return blocked ?? await operation();
    } finally { changing = false; editsBlocked = false; }
  }

  function createWorkspace(snapshot: WorkspaceSnapshot): Promise<WorkspaceManagementResult> {
    return manage(async () => {
      if (!snapshot.name.trim() || snapshot.name.trim().length > 40) return { ok: false, reason: "invalid-name" };
      const catalog = await listWorkspaces();
      if (catalog.length >= 10) return { ok: false, reason: "workspace-limit" };
      if (catalog.some(item => item.name.trim() === snapshot.name.trim())) return { ok: false, reason: "name-conflict" };
      // Management creates are acknowledged before activation. Failed requests
      // leave the existing workspace intact and never fabricate a local copy.
      const result = await transport.createWorkspace(snapshot);
      if (!result.ok) return result;
      const hydrated = await store.hydrateWorkspaceFromServer(result.workspace.snapshot, result.workspace.revision);
      if (!hydrated.ok) return { ok: false, reason: hydrated.reason };
      setState({ status: "ready", workspace: hydrated.workspace });
      return { ok: true };
    });
  }

  function renameWorkspace(id: string, name: string): Promise<WorkspaceManagementResult> {
    return manage(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 40) return { ok: false, reason: "invalid-name" };
      const catalog = await listWorkspaces();
      if (catalog.some(item => item.id !== id && item.name.trim() === trimmed)) return { ok: false, reason: "name-conflict" };
      if (!(await flushWorkspace(id))) return { ok: false, reason: "unsaved-changes" };
      const remote = await transport.getWorkspace(id);
      if (!remote.ok) return remote;
      if (transport.renameWorkspace === undefined) return { ok: false, reason: "protocol-error" };
      const result = await transport.renameWorkspace(id, trimmed, remote.workspace.revision);
      if (!result.ok) return result;
      const hydrated = await store.hydrateWorkspaceFromServer(result.workspace.snapshot, result.workspace.revision);
      if (!hydrated.ok) return { ok: false, reason: hydrated.reason };
      if (state.status === "ready" && state.workspace.id === id) setState({ status: "ready", workspace: hydrated.workspace });
      return { ok: true };
    });
  }

  function deleteWorkspace(id: string): Promise<WorkspaceManagementResult> {
    return manage(async () => {
      const candidates = await listWorkspaces();
      if (candidates.length <= 1) return { ok: false, reason: "last-workspace" };
      if (!(await flushWorkspace(id))) return { ok: false, reason: "unsaved-changes" };
      const active = state.status === "ready" && state.workspace.id === id;
      const fallbackId = candidates.find(item => item.id !== id)!.id;
      // Materialize the fallback BEFORE deletion. A failed pull cannot strand
      // the current session after the irreversible server operation.
      let fallback = active ? await store.getWorkspace(fallbackId) : undefined;
      if (active && fallback === undefined) {
        await coordinator.pullWorkspace(fallbackId);
        fallback = await store.getWorkspace(fallbackId);
        if (fallback === undefined) return { ok: false, reason: "network-error" };
      }
      const local = await store.getWorkspace(id);
      const current = await transport.getWorkspace(id);
      if (current.ok) {
        if (local?.serverRevision !== undefined && local.serverRevision !== null && local.serverRevision !== current.workspace.revision) {
          return { ok: false, reason: "revision-conflict" };
        }
        if (transport.deleteWorkspace === undefined) return { ok: false, reason: "protocol-error" };
        const deleted = await transport.deleteWorkspace(id, current.workspace.revision);
        if (!deleted.ok && deleted.reason !== "not-found") return deleted;
      } else if (current.reason !== "not-found") return current;
      if (!(await store.deleteWorkspace(id, local?.localGeneration))) return { ok: false, reason: "unsaved-changes" };
      memory.forget(id);
      if (active && fallback !== undefined) setState({ status: "ready", workspace: fallback });
      return { ok: true };
    });
  }

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    listeners.clear();
    beforeChange.clear();
    store.close();
  }

  /**
   * Opens one local workspace immediately, then reconciles it once:
   * clean → pull, dirty → sync, conflict → no network at all. Whatever the
   * reconcile outcome, the latest IndexedDB record wins in state — the
   * bootstrap-time object is stale the moment anything changed.
   */
  async function openAndReconcile(record: LocalWorkspaceRecord): Promise<void> {
    setState({ status: "ready", workspace: record });
    const remoteResult = await reconcileOnce(record.id);
    await refreshReadyState(record.id, remoteResult);
  }

  /** clean → pull, dirty → sync, conflict → no network. */
  async function reconcileOnce(workspaceId: WorkspaceId): Promise<WorkspaceRuntimeRemoteResult> {
    const current = await store.getWorkspace(workspaceId);
    if (current === undefined) {
      throw new Error(
        `internal invariant violated: open workspace ${workspaceId} disappeared from the local store`
      );
    }
    if (current.syncState === "conflict") {
      return { status: "conflict-present", workspaceId };
    }
    if (current.syncState === "dirty") {
      return coordinator.syncWorkspace(workspaceId);
    }
    return coordinator.pullWorkspace(workspaceId);
  }

  /** Re-reads the record and updates ready state; returns the fresh record. */
  async function refreshReadyState(
    workspaceId: WorkspaceId,
    remoteResult: WorkspaceRuntimeRemoteResult
  ): Promise<LocalWorkspaceRecord> {
    const latest = await store.getWorkspace(workspaceId);
    if (latest === undefined) {
      throw new Error(
        `internal invariant violated: open workspace ${workspaceId} disappeared from the local store`
      );
    }
    if (state.status === "ready" && state.workspace.id === workspaceId) {
      setState({ status: "ready", workspace: latest, lastRemoteResult: remoteResult });
    }
    return latest;
  }

  function localCandidate(record: LocalWorkspaceRecord) {
    return {
      source: "local" as const,
      id: record.id,
      name: record.snapshot.name,
      syncState: record.syncState,
      serverRevision: record.serverRevision,
    };
  }

  function remoteUnavailableState(
    result: Extract<ListRemoteWorkspacesResult, { ok: false }>
  ): WorkspaceClientRuntimeState {
    switch (result.reason) {
      case "network-error":
        return { status: "remote-unavailable", reason: "network-error" };
      case "server-error":
        return {
          status: "remote-unavailable",
          reason: "server-error",
          httpStatus: result.status,
        };
      case "protocol-error":
        return protocolUnavailable(result.status);
    }
  }

  function remotePullUnavailableState(result: PullWorkspaceResult): WorkspaceClientRuntimeState {
    switch (result.status) {
      case "network-error":
        return { status: "remote-unavailable", reason: "network-error" };
      case "server-error":
        return {
          status: "remote-unavailable",
          reason: "server-error",
          httpStatus: result.httpStatus,
        };
      case "protocol-error":
        return protocolUnavailable(result.httpStatus);
      case "not-found":
        // The catalog just listed this workspace; a 404 now is contract
        // drift, not a business state.
        return protocolUnavailable(undefined);
      default:
        // local-changes-present / stale-server-revision / hydrated all
        // imply a local record exists — reaching this without one is an
        // internal invariant violation, not a guessable state.
        throw new Error(
          `internal invariant violated: pull reported ${result.status} with no local record`
        );
    }
  }

  function protocolUnavailable(httpStatus?: number): WorkspaceClientRuntimeState {
    return httpStatus === undefined
      ? { status: "remote-unavailable", reason: "protocol-error" }
      : { status: "remote-unavailable", reason: "protocol-error", httpStatus };
  }

  return {
    getSnapshot,
    listWorkspaces,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    registerBeforeWorkspaceChange,
    subscribe,
    initialize,
    selectWorkspace,
    stageWorkspaceCreate,
    stageWorkspaceUpdate,
    syncCurrent,
    pullCurrent,
    close,
  };
}
