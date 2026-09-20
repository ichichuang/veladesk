import type { WorkspaceSnapshot } from "@veladesk/domain";

/**
 * Pure helper: every content asset id referenced by a workspace snapshot,
 * deduplicated, in first-occurrence order of `workspace.entities`.
 *
 * Only `app.icon.kind === "asset"` references count. Folders and dock pins
 * point at the same entities and never add references.
 */
export function collectSnapshotAssetIds(
  snapshot: WorkspaceSnapshot
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const entity of snapshot.entities) {
    if (entity.kind === "app" && entity.icon.kind === "asset") {
      const assetId = entity.icon.assetId;
      if (!seen.has(assetId)) {
        seen.add(assetId);
        ordered.push(assetId);
      }
    }
  }
  return ordered;
}
