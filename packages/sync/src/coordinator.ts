import type { WorkspaceId } from "@veladesk/domain";
import type { WorkspaceOutboxEntry } from "@veladesk/local-store";

import { isPositiveSafeInteger } from "./internal";
import type {
  RemoteWorkspace,
  SyncWorkspaceResult,
  WorkspaceSyncCoordinator,
  WorkspaceSyncCoordinatorOptions,
} from "./types";

/**
 * Explicit coordinator between the local outbox and the network transport.
 *
 * No timers, no retries, no background scheduling: every mutation is sent
 * by an explicit `syncWorkspace` call. The outbox entry is captured once
 * per request (id, operation, base revision, snapshot, local generation) —
 * IndexedDB may keep changing while the request is in flight, and the
 * captured generation is what the local-store acknowledgement checks
 * against, so in-flight edits are never overwritten.
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
          throw new Error(
            `ambiguous create outcome for workspace ${workspaceId}: recovery is not part of this stage`
          );
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
        throw new Error(
          `ambiguous save outcome for workspace ${workspaceId}: recovery is not part of this stage`
        );
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

  function protocolResult(workspaceId: WorkspaceId, status?: number): SyncWorkspaceResult {
    return status === undefined
      ? { status: "protocol-error", workspaceId }
      : { status: "protocol-error", workspaceId, httpStatus: status };
  }

  return { syncWorkspace };
}
