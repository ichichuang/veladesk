import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * V1 persistence representation: current aggregate snapshot plus append-only
 * revision snapshots. This is deliberately NOT a normalized projection of
 * the Workspace Domain — see docs/architecture/database-persistence.md.
 *
 * Timestamps are Unix epoch milliseconds stored as INTEGER, never ISO
 * strings. Revisions are per-workspace, strictly monotonic (1, 2, 3, …);
 * there is no global auto-increment revision.
 */

export const workspaces = sqliteTable("workspaces", {
  /** WorkspaceSnapshot.id */
  id: text("id").primaryKey(),
  /** Listing projection of snapshot.name; kept in sync on every save. */
  name: text("name").notNull(),
  /** Current revision; starts at 1 on create. */
  revision: integer("revision").notNull(),
  snapshotVersion: integer("snapshot_version").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const workspaceRevisions = sqliteTable(
  "workspace_revisions",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    snapshotVersion: integer("snapshot_version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.revision] })],
);
