import type { WorkspaceSnapshot } from "@veladesk/domain";

/**
 * Pure helper: every content asset id referenced by a workspace snapshot,
 * deduplicated, in first-occurrence order.
 *
 * References counted: `app.icon.kind === "asset"` icons, the workspace
 * default wallpaper (`preferences.appearance.wallpaper`) and per-section
 * wallpaper overrides (`page.wallpaper`) — all part of the canonical
 * reachability set used for export/import, sync ordering and garbage
 * collection (023-C.3). Folders and dock pins point at the same entities
 * and never add references.
 */
export function collectSnapshotAssetIds(
  snapshot: WorkspaceSnapshot
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (assetId: string): void => {
    if (!seen.has(assetId)) {
      seen.add(assetId);
      ordered.push(assetId);
    }
  };
  for (const entity of snapshot.entities) {
    if (entity.kind === "app" && entity.icon.kind === "asset") {
      add(entity.icon.assetId);
    }
  }
  const workspaceWallpaper = snapshot.preferences.appearance?.wallpaper;
  if (workspaceWallpaper?.kind === "asset") {
    add(workspaceWallpaper.assetId);
  }
  for (const page of snapshot.pages) {
    if (page.wallpaper?.kind === "asset") {
      add(page.wallpaper.assetId);
    }
  }
  return ordered;
}
