import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

function unexpected(): never { throw new Error("Unexpected workspace management in this test"); }
export const runtimeManagementStub: Pick<WorkspaceClientRuntime, "listWorkspaces" | "createWorkspace" | "renameWorkspace" | "deleteWorkspace" | "registerBeforeWorkspaceChange"> = {
  listWorkspaces: unexpected,
  createWorkspace: unexpected,
  renameWorkspace: unexpected,
  deleteWorkspace: unexpected,
  registerBeforeWorkspaceChange: () => () => {},
};
