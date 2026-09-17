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
 * and reconciles in the background; multiple local copies ask the user to
 * choose (never guessing without a persisted active-workspace id); only an
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
      // No persisted active-workspace id in v1: with several local copies
      // the user must choose; the remote catalog is not even consulted.
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
    if (remote.workspaces.length === 1) {
      const only = remote.workspaces[0]!;
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
    const local = await store.getWorkspace(workspaceId);
    if (local !== undefined) {
      setState({ status: "ready", workspace: local });
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

  async function stageWorkspaceUpdate(
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
    if (result.ok) {
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

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    listeners.clear();
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
    setState({ status: "ready", workspace: latest, lastRemoteResult: remoteResult });
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
