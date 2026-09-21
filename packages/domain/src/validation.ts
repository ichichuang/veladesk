import { validateCanvasLayout } from "@veladesk/canvas-engine";
import type { CanvasValidationIssue } from "@veladesk/canvas-engine";
import { validatePageLayout } from "@veladesk/desktop-engine";
import type { LayoutValidationIssue } from "@veladesk/desktop-engine";

import { pageItemIds } from "./canvas";
import { validateAppVisualStyle } from "./app-visual";
import type { AppVisualValidationIssue } from "./app-visual";
import { validateWorkspaceAppearance } from "./appearance";
import type { WorkspaceAppearanceValidationIssue } from "./appearance";
import type {
  CategoryId,
  DesktopPageId,
  EntityId,
  WorkspaceEntity,
  WorkspaceSnapshot,
} from "./types";

/**
 * One discoverable defect of a workspace snapshot.
 *
 * The validator returns every issue it can find instead of throwing or
 * stopping at the first defect, but identity lookups stay deterministic:
 * lookup maps keep the FIRST occurrence of an id; later duplicates are
 * reported as `duplicate-*-id` issues and never overwrite the winner.
 */
export type WorkspaceValidationIssue =
  | {
      readonly type: "invalid-workspace-id";
    }
  | {
      readonly type: "duplicate-page-id";
      readonly pageId: DesktopPageId;
    }
  | {
      readonly type: "invalid-page-id";
      readonly pageId: DesktopPageId;
    }
  | {
      readonly type: "duplicate-entity-id";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "invalid-entity-id";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "duplicate-category-id";
      readonly categoryId: CategoryId;
    }
  | {
      readonly type: "invalid-category-id";
      readonly categoryId: CategoryId;
    }
  | {
      readonly type: "invalid-workspace-name";
    }
  | {
      readonly type: "invalid-page-name";
      readonly pageId: DesktopPageId;
    }
  | {
      readonly type: "invalid-entity-name";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "invalid-category-name";
      readonly categoryId: CategoryId;
    }
  | {
      readonly type: "page-layout-id-mismatch";
      readonly pageId: DesktopPageId;
      readonly layoutId: string;
    }
  | {
      readonly type: "page-layout-invalid";
      readonly pageId: DesktopPageId;
      readonly issue: LayoutValidationIssue;
    }
  | {
      readonly type: "page-canvas-invalid";
      readonly pageId: DesktopPageId;
      readonly issue: CanvasValidationIssue;
    }
  | {
      readonly type: "canvas-page-has-legacy-items";
      readonly pageId: DesktopPageId;
    }
  | {
      readonly type: "layout-entity-missing";
      readonly pageId: DesktopPageId;
      readonly entityId: EntityId;
    }
  | {
      readonly type: "entity-multiple-containers";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "folder-child-missing";
      readonly folderId: EntityId;
      readonly childId: EntityId;
    }
  | {
      readonly type: "folder-child-not-app";
      readonly folderId: EntityId;
      readonly childId: EntityId;
    }
  | {
      readonly type: "folder-child-duplicate";
      readonly folderId: EntityId;
      readonly childId: EntityId;
    }
  | {
      readonly type: "dock-entity-missing";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "dock-widget-not-allowed";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "dock-entity-duplicate";
      readonly entityId: EntityId;
    }
  | {
      readonly type: "default-page-missing";
      readonly pageId: DesktopPageId;
    }
  | {
      readonly type: "invalid-appearance-preference";
      readonly issue: WorkspaceAppearanceValidationIssue;
    }
  | {
      readonly type: "app-category-missing";
      readonly appId: EntityId;
      readonly categoryId: CategoryId;
    }
  | {
      readonly type: "invalid-app-url";
      readonly appId: EntityId;
    }
  | {
      readonly type: "invalid-app-visual";
      readonly entityId: EntityId;
      readonly issue: AppVisualValidationIssue;
    }
  | {
      readonly type: "invalid-widget-type";
      readonly widgetId: EntityId;
    };

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Validate a whole workspace snapshot.
 *
 * Deterministic issue order:
 * 1. workspace-level identity/scalars
 * 2. page identity/name/layout, then canvas-exclusivity + canvas semantics
 * 3. entity identity/name/basic scalars (incl. per-app visual semantics)
 * 4. category identity/name
 * 5. layout references (canvas items when a canvas exists, grid items else)
 * 6. folder references
 * 7. exclusive-container violations
 * 8. dock
 * 9. preferences/default page + appearance semantics
 * 10. app category references
 *
 * Within a group, issues follow the source array order. Identifier strings
 * must be non-blank (`id.trim().length > 0`); blank ids are reported as
 * `invalid-*-id` without trimming — values with surrounding whitespace stay
 * valid and are stored verbatim. Identity lookups resolve to the first
 * occurrence of an id; later duplicates only produce
 * `duplicate-*-id` issues. Container uniqueness counts distinct containers
 * (an id listed twice inside one folder is a `folder-child-duplicate`, not
 * a container violation) and only for entities that actually resolve.
 *
 * Spatial layout rules (overlap, bounds, spans, duplicate layout item ids)
 * are NOT reimplemented here: they are delegated to the desktop engine via
 * `validatePageLayout` and wrapped as `page-layout-invalid`, so engine rule
 * upgrades are reused automatically. Canvas rules are delegated the same way
 * to the canvas engine's `validateCanvasLayout` and wrapped as
 * `page-canvas-invalid`. Never mutates the snapshot.
 */
export function validateWorkspace(workspace: WorkspaceSnapshot): readonly WorkspaceValidationIssue[] {
  const issues: WorkspaceValidationIssue[] = [];

  // 1. Workspace-level identity and scalars.
  if (isBlank(workspace.id)) {
    issues.push({ type: "invalid-workspace-id" });
  }
  if (isBlank(workspace.name)) {
    issues.push({ type: "invalid-workspace-name" });
  }

  // 2. Page identity, names and layout (first occurrence wins below).
  const pageIds = new Set<string>();
  for (const page of workspace.pages) {
    if (isBlank(page.id)) {
      issues.push({ type: "invalid-page-id", pageId: page.id });
    }

    if (pageIds.has(page.id)) {
      issues.push({ type: "duplicate-page-id", pageId: page.id });
    } else {
      pageIds.add(page.id);
    }

    if (isBlank(page.name)) {
      issues.push({ type: "invalid-page-name", pageId: page.id });
    }

    if (page.layout.id !== page.id) {
      issues.push({ type: "page-layout-id-mismatch", pageId: page.id, layoutId: page.layout.id });
    }

    for (const issue of validatePageLayout(page.layout)) {
      issues.push({ type: "page-layout-invalid", pageId: page.id, issue });
    }

    // Canvas pages carry exactly one authoritative item list: a canvas plus
    // legacy items would give the same page two membership sources.
    if (page.canvas !== undefined) {
      if (page.layout.items.length > 0) {
        issues.push({ type: "canvas-page-has-legacy-items", pageId: page.id });
      }
      for (const issue of validateCanvasLayout(page.canvas)) {
        issues.push({ type: "page-canvas-invalid", pageId: page.id, issue });
      }
    }
  }

  // 3. Entity identity, names and basic scalars (first occurrence wins).
  const entityById = new Map<string, WorkspaceEntity>();
  for (const entity of workspace.entities) {
    if (isBlank(entity.id)) {
      issues.push({ type: "invalid-entity-id", entityId: entity.id });
    }

    if (entityById.has(entity.id)) {
      issues.push({ type: "duplicate-entity-id", entityId: entity.id });
    } else {
      entityById.set(entity.id, entity);
    }

    if (entity.kind === "app") {
      if (isBlank(entity.name)) {
        issues.push({ type: "invalid-entity-name", entityId: entity.id });
      }
      if (isBlank(entity.url)) {
        issues.push({ type: "invalid-app-url", appId: entity.id });
      }
      // Per-app visual semantics — only when a persisted style exists.
      // Legacy apps without one are valid by definition; the shared range
      // rules live in `validateAppVisualStyle` and are never duplicated.
      if (entity.visual !== undefined) {
        for (const issue of validateAppVisualStyle(entity.visual)) {
          issues.push({ type: "invalid-app-visual", entityId: entity.id, issue });
        }
      }
    } else if (entity.kind === "folder") {
      if (isBlank(entity.name)) {
        issues.push({ type: "invalid-entity-name", entityId: entity.id });
      }
    } else {
      if (isBlank(entity.widgetType)) {
        issues.push({ type: "invalid-widget-type", widgetId: entity.id });
      }
    }
  }

  // 4. Category identity and names (first occurrence wins).
  const categoryIds = new Set<string>();
  for (const category of workspace.categories) {
    if (isBlank(category.id)) {
      issues.push({ type: "invalid-category-id", categoryId: category.id });
    }

    if (categoryIds.has(category.id)) {
      issues.push({ type: "duplicate-category-id", categoryId: category.id });
    } else {
      categoryIds.add(category.id);
    }

    if (isBlank(category.name)) {
      issues.push({ type: "invalid-category-name", categoryId: category.id });
    }
  }

  // 5. Layout references: every placed item must resolve to an entity. The
  // membership source is the canvas when one exists, the grid layout else.
  for (const page of workspace.pages) {
    for (const itemId of pageItemIds(page)) {
      if (!entityById.has(itemId)) {
        issues.push({ type: "layout-entity-missing", pageId: page.id, entityId: itemId });
      }
    }
  }

  // 6. Folder references: children must resolve, be apps and be unique.
  for (const entity of workspace.entities) {
    if (entity.kind !== "folder") {
      continue;
    }
    const seenChildren = new Set<string>();
    for (const childId of entity.children) {
      const child = entityById.get(childId);
      if (child === undefined) {
        issues.push({ type: "folder-child-missing", folderId: entity.id, childId });
      } else if (child.kind !== "app") {
        issues.push({ type: "folder-child-not-app", folderId: entity.id, childId });
      }
      if (seenChildren.has(childId)) {
        issues.push({ type: "folder-child-duplicate", folderId: entity.id, childId });
      } else {
        seenChildren.add(childId);
      }
    }
  }

  // 7. Exclusive containers: an entity belongs to at most one page OR one
  // folder (dock pins do not count). Distinct containers only, resolved
  // entities only; reported in entities array order.
  const containersByEntity = new Map<string, Set<string>>();
  function addContainer(entityId: string, containerKey: string): void {
    const containers = containersByEntity.get(entityId);
    if (containers) {
      containers.add(containerKey);
    } else {
      containersByEntity.set(entityId, new Set([containerKey]));
    }
  }

  for (const page of workspace.pages) {
    for (const itemId of pageItemIds(page)) {
      if (entityById.has(itemId)) {
        addContainer(itemId, `page:${page.id}`);
      }
    }
  }
  for (const entity of workspace.entities) {
    if (entity.kind === "folder") {
      for (const childId of entity.children) {
        if (entityById.has(childId)) {
          addContainer(childId, `folder:${entity.id}`);
        }
      }
    }
  }
  for (const entity of workspace.entities) {
    const containers = containersByEntity.get(entity.id);
    if (containers && containers.size > 1) {
      issues.push({ type: "entity-multiple-containers", entityId: entity.id });
    }
  }

  // 8. Dock: entries must resolve, must not be widgets, and be unique.
  const seenDockItems = new Set<string>();
  for (const entityId of workspace.dock.items) {
    const entity = entityById.get(entityId);
    if (entity === undefined) {
      issues.push({ type: "dock-entity-missing", entityId });
    } else if (entity.kind === "widget") {
      issues.push({ type: "dock-widget-not-allowed", entityId });
    }
    if (seenDockItems.has(entityId)) {
      issues.push({ type: "dock-entity-duplicate", entityId });
    } else {
      seenDockItems.add(entityId);
    }
  }

  // 9. Preferences: the default page must exist (first occurrence wins).
  if (!pageIds.has(workspace.preferences.defaultPageId)) {
    issues.push({
      type: "default-page-missing",
      pageId: workspace.preferences.defaultPageId,
    });
  }

  // 9b. Appearance semantics — only when a persisted appearance exists.
  // Legacy snapshots without one are valid by definition; the shared range
  // rules live in `validateWorkspaceAppearance` and are never duplicated.
  if (workspace.preferences.appearance !== undefined) {
    for (const issue of validateWorkspaceAppearance(workspace.preferences.appearance)) {
      issues.push({ type: "invalid-appearance-preference", issue });
    }
  }

  // 10. App category references: assigned categories must exist.
  for (const entity of workspace.entities) {
    if (entity.kind === "app" && entity.categoryId !== undefined) {
      if (!categoryIds.has(entity.categoryId)) {
        issues.push({
          type: "app-category-missing",
          appId: entity.id,
          categoryId: entity.categoryId,
        });
      }
    }
  }

  return issues;
}
