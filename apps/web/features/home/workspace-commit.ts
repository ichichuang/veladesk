import type {
  RuntimeStageWorkspaceUpdateResult,
  WorkspaceClientRuntime,
} from "@veladesk/client-runtime";
import type { WorkspaceSnapshot } from "@veladesk/domain";

/**
 * The one local-first commit path for every workspace edit: stage the next
 * snapshot locally (the UI updates the moment this resolves), then fire an
 * explicit sync attempt without waiting for it.
 *
 * The staging result is returned to the caller — failures are never hidden
 * and never rolled back. Network failures only surface through the
 * workspace sync state; conflicts are never re-sent by the runtime.
 */
export async function stageWorkspaceAndTrySync(
  runtime: WorkspaceClientRuntime,
  nextSnapshot: WorkspaceSnapshot
): Promise<RuntimeStageWorkspaceUpdateResult> {
  const result = await runtime.stageWorkspaceUpdate(nextSnapshot);
  if (result.ok) {
    void runtime.syncCurrent().catch(() => {});
  }
  return result;
}
