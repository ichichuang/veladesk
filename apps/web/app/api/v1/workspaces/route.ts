import {
  getDataDirSizeGuard,
  getEngineeringAuth,
  getWorkspaceRepository,
} from "../../../../server/runtime";
import {
  handleCreateWorkspace,
  handleListWorkspaces,
} from "../../../../server/api/workspace-handlers";
import { allowFirstWorkspaceBootstrap, requireEngineeringSession } from "../../../../server/api/engineering-guard";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleListWorkspaces(getWorkspaceRepository());
}

// The ONE documented write exception (t181): creating a workspace while
// the server still holds none stays open so a fresh self-hosted install
// can finish onboarding in Use mode. Every later write needs Engineering.
export async function POST(request: Request): Promise<Response> {
  const repository = getWorkspaceRepository();
  if (!allowFirstWorkspaceBootstrap(repository)) {
    const denied = requireEngineeringSession(getEngineeringAuth(), request);
    if (denied !== null) {
      return denied;
    }
  }
  return handleCreateWorkspace(repository, request, getDataDirSizeGuard());
}
