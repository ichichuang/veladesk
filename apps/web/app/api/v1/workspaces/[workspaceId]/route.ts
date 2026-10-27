import { getDataDirSizeGuard, getWorkspaceRepository } from "../../../../../server/runtime";
import {
  handleGetWorkspace,
  handleRenameWorkspace,
  handleDeleteWorkspace,
  handleSaveWorkspace,
} from "../../../../../server/api/workspace-handlers";

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
  const { workspaceId } = await context.params;
  return handleSaveWorkspace(getWorkspaceRepository(), request, workspaceId, getDataDirSizeGuard());
}

export async function PATCH(request: Request, context: WorkspaceRouteContext): Promise<Response> {
  const { workspaceId } = await context.params;
  return handleRenameWorkspace(getWorkspaceRepository(), request, workspaceId, getDataDirSizeGuard());
}

// DELETE stays guard-free on purpose: deleting a workspace frees space
// and must keep working while storage is full.
export async function DELETE(request: Request, context: WorkspaceRouteContext): Promise<Response> {
  const { workspaceId } = await context.params;
  return handleDeleteWorkspace(getWorkspaceRepository(), request, workspaceId);
}
