import { getWorkspaceRepository } from "../../../../server/runtime";
import {
  handleCreateWorkspace,
  handleListWorkspaces,
} from "../../../../server/api/workspace-handlers";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleListWorkspaces(getWorkspaceRepository());
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateWorkspace(getWorkspaceRepository(), request);
}
