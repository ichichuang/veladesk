import { getWorkspaceRepository } from "../../../../../server/runtime";
import {
  handleGetWorkspace,
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
