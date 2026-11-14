import {
  getDataDirSizeGuard,
  getEngineeringAuth,
  getWorkspaceRepository,
} from "../../../../../server/runtime";
import {
  handleGetWorkspace,
  handleRenameWorkspace,
  handleDeleteWorkspace,
  handleSaveWorkspace,
} from "../../../../../server/api/workspace-handlers";
import { requireEngineeringSession } from "../../../../../server/api/engineering-guard";

export const runtime = "nodejs";

interface WorkspaceRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(
  _request: Request,
  context: WorkspaceRouteContext,
): Promise<Response> {
  const { workspaceId } = await context.params;
  return handleGetWorkspace(getWorkspaceRepository(), workspaceId);
}

export async function PUT(
  request: Request,
  context: WorkspaceRouteContext,
): Promise<Response> {
  // t181: workspace writes are Engineering-mode-only (server-enforced).
  const denied = requireEngineeringSession(getEngineeringAuth(), request);
  if (denied !== null) {
    return denied;
  }
  const { workspaceId } = await context.params;
  return handleSaveWorkspace(getWorkspaceRepository(), request, workspaceId, getDataDirSizeGuard());
}

export async function PATCH(request: Request, context: WorkspaceRouteContext): Promise<Response> {
  const denied = requireEngineeringSession(getEngineeringAuth(), request);
  if (denied !== null) {
    return denied;
  }
  const { workspaceId } = await context.params;
  return handleRenameWorkspace(getWorkspaceRepository(), request, workspaceId, getDataDirSizeGuard());
}

// Storage-full never blocks a delete (it frees space), but Engineering
// mode does: deleting a workspace is an edit like any other (t181).
export async function DELETE(request: Request, context: WorkspaceRouteContext): Promise<Response> {
  const denied = requireEngineeringSession(getEngineeringAuth(), request);
  if (denied !== null) {
    return denied;
  }
  const { workspaceId } = await context.params;
  return handleDeleteWorkspace(getWorkspaceRepository(), request, workspaceId);
}
