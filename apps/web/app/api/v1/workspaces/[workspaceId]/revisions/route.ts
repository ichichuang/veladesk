import { getWorkspaceRepository } from "../../../../../../server/runtime";
import { handleListWorkspaceRevisions } from "../../../../../../server/api/revision-handlers";

export const runtime = "nodejs";

interface WorkspaceRevisionsRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(
  _request: Request,
  context: WorkspaceRevisionsRouteContext,
): Promise<Response> {
  const { workspaceId } = await context.params;
  return handleListWorkspaceRevisions(getWorkspaceRepository(), workspaceId);
}
