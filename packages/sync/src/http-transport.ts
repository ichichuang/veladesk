import { decodeWorkspaceSnapshot, validateWorkspace } from "@veladesk/domain";
import type { WorkspaceId, WorkspaceSnapshot } from "@veladesk/domain";

import { isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord } from "./internal";
import type {
  CreateRemoteWorkspaceResult,
  GetRemoteWorkspaceResult,
  HttpWorkspaceSyncTransportOptions,
  RemoteWorkspace,
  SaveRemoteWorkspaceResult,
  WorkspaceSyncTransport,
} from "./types";

/**
 * Browser-safe HTTP transport for the workspace API v1.
 *
 * Every response body is treated as unknown JSON and decoded structurally
 * (`decodeWorkspaceSnapshot`) and semantically (`validateWorkspace`) before
 * it leaves this module — a `response.json() as WorkspaceSnapshot` cast
 * would let server drift flow straight into IndexedDB. Success responses
 * with a domain-invalid snapshot, an id mismatch or impossible metadata are
 * protocol errors, not data.
 */

const WORKSPACES_COLLECTION_PATH = "/api/v1/workspaces";

export function createHttpWorkspaceSyncTransport(
  options: HttpWorkspaceSyncTransportOptions = {}
): WorkspaceSyncTransport {
  const baseUrlOption = options.baseUrl ?? "";
  if (baseUrlOption !== "" && baseUrlOption.trim().length === 0) {
    throw new RangeError(
      `baseUrl must not be whitespace-only, received: "${baseUrlOption}"`
    );
  }
  let baseUrl = baseUrlOption;
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "createHttpWorkspaceSyncTransport requires fetch: globalThis.fetch is not available"
    );
  }
  const doFetch = fetchImpl.bind(globalThis);

  async function fetchJson(
    url: string,
    init: RequestInit
  ): Promise<{ ok: true; response: Response } | { ok: false; reason: "network-error" }> {
    try {
      const response = await doFetch(url, { ...init, cache: "no-store" });
      return { ok: true, response };
    } catch {
      return { ok: false, reason: "network-error" };
    }
  }

  function workspaceUrl(workspaceId: WorkspaceId): string {
    return `${baseUrl}${WORKSPACES_COLLECTION_PATH}/${encodeURIComponent(workspaceId)}`;
  }

  /**
   * Decodes a success envelope `{ workspace: { snapshot, revision,
   * createdAt, updatedAt } }`. Any shape violation, id mismatch or
   * domain-invalid snapshot is a protocol error that must never be
   * persisted locally.
   */
  async function decodeSuccessResponse(
    response: Response,
    expectedWorkspaceId: WorkspaceId
  ): Promise<{ ok: true; workspace: RemoteWorkspace } | ProtocolFailure> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: "protocol-error", status: response.status };
    }
    return decodeSuccessBody(body, expectedWorkspaceId, response.status);
  }

  async function readErrorEnvelope(
    response: Response
  ): Promise<{ code?: string; actualRevision?: unknown }> {
    try {
      const body: unknown = await response.json();
      if (!isRecord(body) || !isRecord(body.error)) {
        return {};
      }
      const error = body.error;
      return {
        ...(typeof error.code === "string" ? { code: error.code } : {}),
        ...(error.actualRevision !== undefined ? { actualRevision: error.actualRevision } : {}),
      };
    } catch {
      return {};
    }
  }

  function serverError(response: Response): ServerFailure {
    return { ok: false, reason: "server-error", status: response.status };
  }

  const transport: WorkspaceSyncTransport = {
    async getWorkspace(workspaceId: WorkspaceId): Promise<GetRemoteWorkspaceResult> {
      const fetched = await fetchJson(workspaceUrl(workspaceId), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!fetched.ok) {
        return { ok: false, reason: "network-error" };
      }
      const { response } = fetched;
      if (response.status === 200) {
        return decodeSuccessResponse(response, workspaceId);
      }
      if (response.status === 404) {
        const envelope = await readErrorEnvelope(response);
        if (envelope.code === "workspace-not-found") {
          return { ok: false, reason: "not-found" };
        }
        return { ok: false, reason: "protocol-error", status: response.status };
      }
      if (response.status >= 500) {
        return serverError(response);
      }
      return { ok: false, reason: "protocol-error", status: response.status };
    },

    async createWorkspace(snapshot: WorkspaceSnapshot): Promise<CreateRemoteWorkspaceResult> {
      const fetched = await fetchJson(`${baseUrl}${WORKSPACES_COLLECTION_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ snapshot }),
      });
      if (!fetched.ok) {
        return { ok: false, reason: "network-error" };
      }
      const { response } = fetched;
      if (response.status === 201) {
        return decodeSuccessResponse(response, snapshot.id);
      }
      if (response.status === 409 || response.status === 422) {
        const envelope = await readErrorEnvelope(response);
        if (response.status === 409 && envelope.code === "workspace-already-exists") {
          return { ok: false, reason: "already-exists" };
        }
        if (response.status === 422 && envelope.code === "invalid-workspace") {
          return { ok: false, reason: "invalid-workspace" };
        }
        return { ok: false, reason: "protocol-error", status: response.status };
      }
      if (response.status >= 500) {
        return serverError(response);
      }
      return { ok: false, reason: "protocol-error", status: response.status };
    },

    async saveWorkspace(
      snapshot: WorkspaceSnapshot,
      expectedRevision: number
    ): Promise<SaveRemoteWorkspaceResult> {
      if (!isPositiveSafeInteger(expectedRevision)) {
        throw new RangeError(
          `expectedRevision must be a positive safe integer, received: ${expectedRevision}`
        );
      }
      const fetched = await fetchJson(workspaceUrl(snapshot.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ snapshot, expectedRevision }),
      });
      if (!fetched.ok) {
        return { ok: false, reason: "network-error" };
      }
      const { response } = fetched;
      if (response.status === 200) {
        return decodeSuccessResponse(response, snapshot.id);
      }
      if (response.status === 404) {
        const envelope = await readErrorEnvelope(response);
        if (envelope.code === "workspace-not-found") {
          return { ok: false, reason: "not-found" };
        }
        return { ok: false, reason: "protocol-error", status: response.status };
      }
      if (response.status === 409) {
        const envelope = await readErrorEnvelope(response);
        if (
          envelope.code === "revision-conflict" &&
          isPositiveSafeInteger(envelope.actualRevision)
        ) {
          return {
            ok: false,
            reason: "revision-conflict",
            actualRevision: envelope.actualRevision,
          };
        }
        return { ok: false, reason: "protocol-error", status: response.status };
      }
      if (response.status === 422) {
        const envelope = await readErrorEnvelope(response);
        if (envelope.code === "invalid-workspace") {
          return { ok: false, reason: "invalid-workspace" };
        }
        return { ok: false, reason: "protocol-error", status: response.status };
      }
      if (response.status >= 500) {
        return serverError(response);
      }
      return { ok: false, reason: "protocol-error", status: response.status };
    },
  };

  return transport;
}

type ServerFailure = {
  readonly ok: false;
  readonly reason: "server-error";
  readonly status: number;
};

type ProtocolFailure = {
  readonly ok: false;
  readonly reason: "protocol-error";
  readonly status?: number;
};

function decodeSuccessBody(
  body: unknown,
  expectedWorkspaceId: WorkspaceId,
  status?: number
): { ok: true; workspace: RemoteWorkspace } | ProtocolFailure {
  if (!isRecord(body) || !isRecord(body.workspace)) {
    return withStatus(status);
  }
  const envelope = body.workspace;
  const snapshot = decodeWorkspaceSnapshot(envelope.snapshot);
  if (snapshot === undefined) {
    return withStatus(status);
  }
  if (
    !isPositiveSafeInteger(envelope.revision) ||
    !isNonNegativeSafeInteger(envelope.createdAt) ||
    !isNonNegativeSafeInteger(envelope.updatedAt)
  ) {
    return withStatus(status);
  }
  if (snapshot.id !== expectedWorkspaceId) {
    return withStatus(status);
  }
  if (validateWorkspace(snapshot).length > 0) {
    return withStatus(status);
  }
  return { ok: true, workspace: { snapshot, revision: envelope.revision } };
}

function withStatus(status?: number): ProtocolFailure {
  return status === undefined
    ? { ok: false, reason: "protocol-error" }
    : { ok: false, reason: "protocol-error", status };
}
