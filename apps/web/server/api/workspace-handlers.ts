import type { WorkspaceRepository } from "@veladesk/database";

import { decodeCreateWorkspaceBody, decodeExpectedRevision, decodeSaveWorkspaceBody, isRecord, parseJsonBody } from "./input";
import { errorResponse, jsonResponse } from "./response";

/**
 * HTTP handlers for the workspace collection and item resources.
 *
 * Handlers own request decoding, status mapping and response envelopes and
 * only talk to the `WorkspaceRepository` boundary — no SQL, no domain
 * validation logic. Repository business results (invalid workspace,
 * conflicts) are expected outcomes with dedicated statuses; unexpected
 * repository/SQLite failures keep propagating as 500s.
 */

/** GET /api/v1/workspaces */
export function handleListWorkspaces(repository: WorkspaceRepository): Response {
  return jsonResponse({ workspaces: repository.listWorkspaces() });
}

/** POST /api/v1/workspaces */
export async function handleCreateWorkspace(
  repository: WorkspaceRepository,
  request: Request,
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const snapshot = decodeCreateWorkspaceBody(body.value);
  if (snapshot === undefined) {
    return errorResponse(400, "invalid-request");
  }

  const result = repository.createWorkspace(snapshot);
  if (result.ok) {
    return jsonResponse(
      { workspace: result.workspace },
      {
        status: 201,
        headers: {
          Location: `/api/v1/workspaces/${encodeURIComponent(result.workspace.snapshot.id)}`,
        },
      },
    );
  }
  if (result.reason === "invalid-workspace") {
    return errorResponse(422, "invalid-workspace", { issues: result.issues });
  }
  return errorResponse(409, result.reason === "workspace-limit" ? "workspace-limit" : result.reason === "name-conflict" ? "workspace-name-conflict" : "workspace-already-exists");
}

/** GET /api/v1/workspaces/:workspaceId */
export function handleGetWorkspace(
  repository: WorkspaceRepository,
  workspaceId: string,
): Response {
  const workspace = repository.loadWorkspace(workspaceId);
  if (workspace === undefined) {
    return errorResponse(404, "workspace-not-found");
  }
  return jsonResponse({ workspace });
}

/** PUT /api/v1/workspaces/:workspaceId */
export async function handleSaveWorkspace(
  repository: WorkspaceRepository,
  request: Request,
  workspaceId: string,
): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const decoded = decodeSaveWorkspaceBody(body.value);
  if (decoded === undefined) {
    return errorResponse(400, "invalid-request");
  }

  if (decoded.snapshot.id !== workspaceId) {
    return errorResponse(400, "workspace-id-mismatch");
  }

  const expectedRevision = decodeExpectedRevision(decoded.expectedRevision);
  if (expectedRevision === undefined) {
    return errorResponse(400, "invalid-revision");
  }

  const result = repository.saveWorkspace(decoded.snapshot, expectedRevision);
  if (result.ok) {
    return jsonResponse({ workspace: result.workspace });
  }
  switch (result.reason) {
    case "invalid-workspace":
      return errorResponse(422, "invalid-workspace", { issues: result.issues });
    case "not-found":
      return errorResponse(404, "workspace-not-found");
    case "revision-conflict":
      return errorResponse(409, "revision-conflict", {
        actualRevision: result.actualRevision,
      });
  }
}

/** PATCH /api/v1/workspaces/:workspaceId — same CAS contract as PUT. */
export async function handleRenameWorkspace(repository: WorkspaceRepository, request: Request, workspaceId: string): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || typeof body.value.name !== "string") return errorResponse(400, "invalid-request");
  const revision = decodeExpectedRevision(body.value.expectedRevision);
  if (revision === undefined) return errorResponse(400, "invalid-revision");
  const result = repository.renameWorkspace(workspaceId, body.value.name, revision);
  if (result.ok) return jsonResponse({ workspace: result.workspace });
  switch (result.reason) {
    case "not-found": return errorResponse(404, "workspace-not-found");
    case "invalid-name": return errorResponse(422, "invalid-workspace-name");
    case "name-conflict": return errorResponse(409, "workspace-name-conflict");
    case "invalid-workspace": return errorResponse(422, "invalid-workspace", { issues: result.issues });
    case "revision-conflict": return errorResponse(409, "revision-conflict", { actualRevision: result.actualRevision });
  }
}

/** DELETE uses an expected revision so another tab's edits cannot be erased unseen. */
export async function handleDeleteWorkspace(repository: WorkspaceRepository, request: Request, workspaceId: string): Promise<Response> {
  const body = await parseJsonBody(request);
  if (!body.ok) return body.response;
  const revision = isRecord(body.value) ? decodeExpectedRevision(body.value.expectedRevision) : undefined;
  if (revision === undefined) return errorResponse(400, "invalid-revision");
  const result = repository.deleteWorkspace(workspaceId, revision);
  if (result.ok) return new Response(null, { status: 204 });
  if (result.reason === "not-found") return errorResponse(404, "workspace-not-found");
  if (result.reason === "last-workspace") return errorResponse(409, "last-workspace");
  return errorResponse(409, "revision-conflict", { actualRevision: result.actualRevision });
}
