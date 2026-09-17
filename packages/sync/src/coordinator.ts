import type { WorkspaceId } from "@veladesk/domain";
import type { WorkspaceOutboxEntry } from "@veladesk/local-store";

import { areWorkspaceSnapshotsEqual } from "./equality";
import { isPositiveSafeInteger } from "./internal";
import type {
  PullWorkspaceResult,
  RemoteWorkspace,
  SyncWorkspaceResult,
  WorkspaceSyncCoordinator,
  WorkspaceSyncCoordinatorOptions,
} from "./types";

/**
 * Explicit coordinator between the local outbox and the network transport.
 *
 * No timers, no retries, no background scheduling: every mutation is sent
 * by an explicit `syncWorkspace` / `flushOutbox` call. The outbox entry is
 * captured once per request (id, operation, base revision, snapshot, local
 * generation) — IndexedDB may keep changing while the request is in
 * flight, and the captured generation is what the local-store
 * acknowledgement checks against, so in-flight edits are never overwritten.
 *
 * The network is at-least-once: a lost response makes the retry hit a 409
 * even though the earlier request succeeded. Before marking a conflict the
 * coordinator therefore reads the remote current state — if it deep-equals
 * the snapshot that was sent, the earlier request is treated as the
 * success it actually was.
 */
export function createWorkspaceSyncCoordinator(
  options: WorkspaceSyncCoordinatorOptions
): WorkspaceSyncCoordinator {
  const { store, transport } = options;

  // Same-process single-flight per workspace. Different workspaces are
  // independent; there is deliberately no global lock.
  const inFlight = new Map<WorkspaceId, Promise<SyncWorkspaceResult>>();

  function syncWorkspace(workspaceId: WorkspaceId): Promise<SyncWorkspaceResult> {
    const existing = inFlight.get(workspaceId);
    if (existing !== undefined) {
      return existing;
    }
    const promise = runSync(workspaceId).finally(() => {
      inFlight.delete(workspaceId);
    });
    inFlight.set(workspaceId, promise);
    return promise;
  }

  async function flushOutbox(): Promise<readonly SyncWorkspaceResult[]> {
    // One pass over the outbox as it exists right now. A request that
    // succeeds while newer local edits already re-queued work stays
    // `pending` until the NEXT explicit flush — otherwise a continuously
    // editing user could keep a single flush alive forever.
    const entries = await store.listOutboxEntries();
    const results: SyncWorkspaceResult[] = [];
    for (const entry of entries) {
      results.push(await syncWorkspace(entry.workspaceId));
    }
    return results;
  }

  async function pullWorkspace(workspaceId: WorkspaceId): Promise<PullWorkspaceResult> {
    const local = await store.getWorkspace(workspaceId);
    if (local !== undefined && (local.syncState === "dirty" || local.syncState === "conflict")) {
      return { status: "local-changes-present", workspaceId };
    }

    const result = await transport.getWorkspace(workspaceId);
    if (result.ok) {
      const hydrated = await store.hydrateWorkspaceFromServer(
        result.workspace.snapshot,
        result.workspace.revision
      );
      if (hydrated.ok) {
        return { status: "hydrated", workspaceId, serverRevision: result.workspace.revision };
      }
      switch (hydrated.reason) {
        case "local-changes-present":
          // Local state changed between the dirty check and the hydration
          // (e.g. another tab staged an edit) — the store refused safely.
          return { status: "local-changes-present", workspaceId };
        case "stale-server-revision":
          return {
            status: "stale-server-revision",
            workspaceId,
            currentRevision: hydrated.currentRevision,
          };
        case "invalid-workspace":
          // The transport already validated the snapshot semantically.
          throw new Error(
            `internal invariant violated during pull of workspace ${workspaceId}: transport delivered a domain-invalid snapshot`
          );
      }
    }
    switch (result.reason) {
      case "not-found":
        return { status: "not-found", workspaceId };
      case "network-error":
        return { status: "network-error", workspaceId };
      case "server-error":
        return serverErrorPullResult(workspaceId, result.status);
      case "protocol-error":
        return protocolPullResult(workspaceId, result.status);
    }
  }

  async function runSync(workspaceId: WorkspaceId): Promise<SyncWorkspaceResult> {
    const entry = await store.getOutboxEntry(workspaceId);
    if (entry === undefined) {
      return { status: "idle", workspaceId };
    }
    return sendCapturedEntry(workspaceId, entry);
  }

  async function sendCapturedEntry(
    workspaceId: WorkspaceId,
    entry: WorkspaceOutboxEntry
  ): Promise<SyncWorkspaceResult> {
    assertOutboxInvariants(entry);

    if (entry.operation === "create") {
      const result = await transport.createWorkspace(entry.snapshot);
      if (result.ok) {
        return acknowledge(workspaceId, entry.localGeneration, result.workspace);
      }
      switch (result.reason) {
        case "already-exists":
          // The create may already have succeeded with its response lost:
          // never fabricate a conflict before reading the remote state.
          return resolveCreateConflict(workspaceId, entry);
        case "invalid-workspace":
          return { status: "server-rejected", workspaceId };
        case "network-error":
          return { status: "network-error", workspaceId };
        case "server-error":
          return { status: "server-error", workspaceId, httpStatus: result.status };
        case "protocol-error":
          return protocolResult(workspaceId, result.status);
      }
    }

    const baseRevision: number | null = entry.baseRevision;
    if (!isPositiveSafeInteger(baseRevision)) {
      throw new Error(
        `outbox invariant violated: save entry of workspace ${workspaceId} has baseRevision ${String(baseRevision)}`
      );
    }
    const result = await transport.saveWorkspace(entry.snapshot, baseRevision);
    if (result.ok) {
      return acknowledge(workspaceId, entry.localGeneration, result.workspace);
    }
    switch (result.reason) {
      case "revision-conflict":
        // Our write may already have landed with its response lost: check
        // the remote current state before marking a conflict.
        return resolveSaveConflict(workspaceId, entry, result.actualRevision);
      case "not-found":
        // The server workspace is gone. Automatically re-creating a deleted
        // workspace is a policy decision, not a sync primitive behavior.
        return { status: "server-missing", workspaceId };
      case "invalid-workspace":
        return { status: "server-rejected", workspaceId };
      case "network-error":
        return { status: "network-error", workspaceId };
      case "server-error":
        return { status: "server-error", workspaceId, httpStatus: result.status };
      case "protocol-error":
        return protocolResult(workspaceId, result.status);
    }
  }

  /**
   * POST returned `workspace-already-exists`. Read the remote workspace:
   * equal to the sent snapshot → the create already succeeded (acknowledge
   * at the current remote revision); different → a genuine conflict at
   * that revision. A failing GET cannot produce a trustworthy revision, so
   * the dirty create outbox is preserved and the failure is surfaced.
   */
  async function resolveCreateConflict(
    workspaceId: WorkspaceId,
    entry: WorkspaceOutboxEntry
  ): Promise<SyncWorkspaceResult> {
    const remote = await transport.getWorkspace(workspaceId);
    if (remote.ok) {
      if (areWorkspaceSnapshotsEqual(remote.workspace.snapshot, entry.snapshot)) {
        return acknowledge(workspaceId, entry.localGeneration, remote.workspace);
      }
      return markConflict(workspaceId, entry.localGeneration, remote.workspace.revision);
    }
    switch (remote.reason) {
      case "not-found":
        // POST said the workspace exists, GET says it does not:
        // contradictory server state with no trustworthy revision.
        return { status: "server-missing", workspaceId };
      case "network-error":
        return { status: "network-error", workspaceId };
      case "server-error":
        return serverErrorResult(workspaceId, remote.status);
      case "protocol-error":
        return protocolResult(workspaceId, remote.status);
    }
  }

  /**
   * PUT returned `revision-conflict`. Read the remote workspace: equal to
   * the sent snapshot → the write already landed (acknowledge at the
   * current remote revision, even a newer one); different → a genuine
   * conflict, marked at the revision the GET observed. If the GET itself
   * fails, the 409's own actualRevision is still hard knowledge — mark the
   * conflict with it instead of dropping the conflict signal.
   */
  async function resolveSaveConflict(
    workspaceId: WorkspaceId,
    entry: WorkspaceOutboxEntry,
    actualRevision: number
  ): Promise<SyncWorkspaceResult> {
    const remote = await transport.getWorkspace(workspaceId);
    if (remote.ok) {
      if (areWorkspaceSnapshotsEqual(remote.workspace.snapshot, entry.snapshot)) {
        return acknowledge(workspaceId, entry.localGeneration, remote.workspace);
      }
      return markConflict(workspaceId, entry.localGeneration, remote.workspace.revision);
    }
    return markConflict(workspaceId, entry.localGeneration, actualRevision);
  }

  /** Defensive local-store corruption/programming checks — never guesses. */
  function assertOutboxInvariants(entry: WorkspaceOutboxEntry): void {
    if (entry.workspaceId !== entry.snapshot.id) {
      throw new Error(
        `outbox invariant violated: entry workspaceId "${entry.workspaceId}" does not match snapshot id "${entry.snapshot.id}"`
      );
    }
    if (!isPositiveSafeInteger(entry.localGeneration)) {
      throw new Error(
        `outbox invariant violated: localGeneration ${String(entry.localGeneration)} is not a positive safe integer`
      );
    }
    if (entry.operation === "create" && entry.baseRevision !== null) {
      throw new Error(
        `outbox invariant violated: create entry of workspace ${entry.workspaceId} must have baseRevision null`
      );
    }
  }

  /**
   * Applies a successful remote write through the local-store state
   * machine, which decides between clean and still-pending by comparing
   * the captured generation with the current one.
   */
  async function acknowledge(
    workspaceId: WorkspaceId,
    capturedGeneration: number,
    remote: RemoteWorkspace
  ): Promise<SyncWorkspaceResult> {
    const ack = await store.acknowledgeWorkspaceSync({
      workspaceId,
      localGeneration: capturedGeneration,
      serverSnapshot: remote.snapshot,
      serverRevision: remote.revision,
    });
    if (ack.ok) {
      return ack.outbox !== undefined
        ? { status: "pending", workspaceId, serverRevision: remote.revision }
        : { status: "synced", workspaceId, serverRevision: remote.revision };
    }
    switch (ack.reason) {
      case "invalid-workspace":
      case "workspace-id-mismatch":
        // The transport already validated the success response strictly;
        // reaching this means an internal invariant is broken.
        throw new Error(`internal invariant violated during acknowledgement: ${ack.reason}`);
      default:
        // not-found / no-pending-change / stale-generation /
        // stale-server-revision: local state moved on elsewhere first.
        return { status: "superseded", workspaceId };
    }
  }

  /**
   * Records a genuine conflict. The store keeps the local snapshot and the
   * outbox untouched; only the conflict revision is recorded for the later
   * (UI-side) resolution. Superseded markings are a no-op, not an error.
   */
  async function markConflict(
    workspaceId: WorkspaceId,
    capturedGeneration: number,
    actualRevision: number
  ): Promise<SyncWorkspaceResult> {
    const marked = await store.markWorkspaceConflict({
      workspaceId,
      localGeneration: capturedGeneration,
      actualRevision,
    });
    if (marked.ok) {
      return { status: "conflict", workspaceId, actualRevision };
    }
    return { status: "superseded", workspaceId };
  }

  function serverErrorResult(
    workspaceId: WorkspaceId,
    status: number | undefined
  ): SyncWorkspaceResult {
    // A server-error without a status would violate the transport's own
    // contract; treat it as protocol drift rather than hiding the number.
    return status === undefined
      ? { status: "protocol-error", workspaceId }
      : { status: "server-error", workspaceId, httpStatus: status };
  }

  function serverErrorPullResult(
    workspaceId: WorkspaceId,
    status: number | undefined
  ): PullWorkspaceResult {
    return status === undefined
      ? { status: "protocol-error", workspaceId }
      : { status: "server-error", workspaceId, httpStatus: status };
  }

  function protocolPullResult(workspaceId: WorkspaceId, status?: number): PullWorkspaceResult {
    return status === undefined
      ? { status: "protocol-error", workspaceId }
      : { status: "protocol-error", workspaceId, httpStatus: status };
  }

  function protocolResult(workspaceId: WorkspaceId, status?: number): SyncWorkspaceResult {
    return status === undefined
      ? { status: "protocol-error", workspaceId }
      : { status: "protocol-error", workspaceId, httpStatus: status };
  }

  return { syncWorkspace, flushOutbox, pullWorkspace };
}
