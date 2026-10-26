import { getWorkspaceRepository } from "../../../../../server/runtime";
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
  return handleSaveWorkspace(getWorkspaceRepository(), request, workspaceId);
}

export async function PATCH(request: Request, context: WorkspaceRouteContext): Promise<Response> {
  const { workspaceId } = await context.params;
  return handleRenameWorkspace(getWorkspaceRepository(), request, workspaceId);
}

export async function DELETE(request: Request, context: WorkspaceRouteContext): Promise<Response> {
  const { workspaceId } = await context.params;
  return handleDeleteWorkspace(getWorkspaceRepository(), request, workspaceId);
}
