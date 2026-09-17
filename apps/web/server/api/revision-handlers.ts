import type { WorkspaceRepository } from "@veladesk/database";

import { decodeRevisionSegment } from "./input";
import { errorResponse, jsonResponse } from "./response";

/**
 * HTTP handlers for workspace revision resources.
 *
 * A missing workspace and a missing revision are distinct 404s: the API
 * distinguishes "existing resource without that history entry" from
 * "unknown workspace".
 */

/** GET /api/v1/workspaces/:workspaceId/revisions */
export function handleListWorkspaceRevisions(
  repository: WorkspaceRepository,
  workspaceId: string,
): Response {
  if (repository.loadWorkspace(workspaceId) === undefined) {
    return errorResponse(404, "workspace-not-found");
  }
  return jsonResponse({ revisions: repository.listWorkspaceRevisions(workspaceId) });
}

/** GET /api/v1/workspaces/:workspaceId/revisions/:revision */
export function handleGetWorkspaceRevision(
  repository: WorkspaceRepository,
  workspaceId: string,
  revisionSegment: string,
): Response {
  const revision = decodeRevisionSegment(revisionSegment);
  if (revision === undefined) {
    return errorResponse(400, "invalid-revision");
  }

  if (repository.loadWorkspace(workspaceId) === undefined) {
    return errorResponse(404, "workspace-not-found");
  }

  const found = repository.loadWorkspaceRevision(workspaceId, revision);
  if (found === undefined) {
    return errorResponse(404, "revision-not-found");
  }
  return jsonResponse({ revision: found });
}
