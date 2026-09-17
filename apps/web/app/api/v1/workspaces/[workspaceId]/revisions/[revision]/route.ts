import { getWorkspaceRepository } from "../../../../../../../server/runtime";
import { handleGetWorkspaceRevision } from "../../../../../../../server/api/revision-handlers";

export const runtime = "nodejs";

interface WorkspaceRevisionRouteContext {
  params: Promise<{ workspaceId: string; revision: string }>;
}

export async function GET(
  _request: Request,
  context: WorkspaceRevisionRouteContext,
): Promise<Response> {
  const { workspaceId, revision } = await context.params;
  return handleGetWorkspaceRevision(getWorkspaceRepository(), workspaceId, revision);
}
