import type { WorkspaceEntity, WidgetInstance, WorkspaceSnapshot } from "@veladesk/domain";

/** Dockable kinds: apps and (legacy) folders — never widgets. */
export type DockEntity = Exclude<WorkspaceEntity, WidgetInstance>;

/**
 * The dock's pinned entities in stored order: resolvable, non-widget.
 * Pure selector (task 015) — zero pins means the dock does not render at
 * all; utilities and separators are gone from the surface.
 */
export function resolveDockEntities(workspace: WorkspaceSnapshot): DockEntity[] {
  return workspace.dock.items
    .map((entityId) => workspace.entities.find((entity) => entity.id === entityId))
    .filter((entity): entity is DockEntity => entity !== undefined && entity.kind !== "widget");
}
