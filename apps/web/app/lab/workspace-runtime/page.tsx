import type { Metadata } from "next";

import { WorkspaceRuntimeLab } from "../../../features/workspace-runtime/workspace-runtime-lab";

export const metadata: Metadata = {
  title: "Workspace runtime lab — VelaDesk",
};

export default function WorkspaceRuntimeLabPage() {
  return <WorkspaceRuntimeLab />;
}
