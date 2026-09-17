import type {
  Category,
  CategoryId,
  DesktopPage,
  DesktopPageId,
  EntityId,
  WorkspaceEntity,
  WorkspaceSnapshot,
} from "./types";

/**
 * Simple linear lookups on purpose: workspaces are small at this stage and
 * building caches/Maps would add invalidation complexity without benefit.
 * All helpers are pure reads and never mutate the snapshot.
 */

export function findWorkspaceEntity(
  workspace: WorkspaceSnapshot,
  id: EntityId,
): WorkspaceEntity | undefined {
  return workspace.entities.find((entity) => entity.id === id);
}

export function findDesktopPage(
  workspace: WorkspaceSnapshot,
  id: DesktopPageId,
): DesktopPage | undefined {
  return workspace.pages.find((page) => page.id === id);
}

export function findCategory(
  workspace: WorkspaceSnapshot,
  id: CategoryId,
): Category | undefined {
  return workspace.categories.find((category) => category.id === id);
}
