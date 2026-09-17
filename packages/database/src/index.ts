/**
 * Public API of @veladesk/database.
 *
 * Explicit named exports only — no `export *`. The Drizzle schema tables
 * and the serialization helpers stay package-internal on purpose.
 */

export { openDatabase } from "./connection";
export type { OpenDatabaseOptions, VelaDeskDatabase } from "./connection";

export { applyMigrations } from "./migrations";

export { WORKSPACE_SNAPSHOT_VERSION } from "./serialization";

export { createWorkspaceRepository } from "./repository";
export type { WorkspaceRepository } from "./repository";

export type {
  CreateWorkspaceResult,
  SaveWorkspaceResult,
  StoredWorkspace,
  WorkspaceRepositoryOptions,
  WorkspaceRevision,
  WorkspaceRevisionSummary,
  WorkspaceSummary,
} from "./types";
