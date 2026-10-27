import type {
  WorkspaceId,
  WorkspaceSnapshot,
  WorkspaceValidationIssue,
} from "@veladesk/domain";

/** A workspace as stored: snapshot plus row metadata. */
export interface StoredWorkspace {
  readonly snapshot: WorkspaceSnapshot;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Listing projection of a stored workspace; no snapshot parsing needed. */
export interface WorkspaceSummary {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One append-only revision of a workspace. */
export interface WorkspaceRevision {
  readonly snapshot: WorkspaceSnapshot;
  readonly revision: number;
  readonly createdAt: number;
}

/** Listing projection of a workspace revision. */
export interface WorkspaceRevisionSummary {
  readonly workspaceId: WorkspaceId;
  readonly revision: number;
  readonly createdAt: number;
}

/** Result of {@link WorkspaceRepository.createWorkspace}. */
export type CreateWorkspaceResult =
  | {
      readonly ok: true;
      readonly workspace: StoredWorkspace;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
      readonly issues: readonly WorkspaceValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly reason: "already-exists" | "workspace-limit" | "name-conflict";
    };

/**
 * Result of {@link WorkspaceRepository.saveWorkspace}.
 *
 * A revision conflict is a normal concurrent state, not an exception: the
 * caller receives the actual revision and decides how to reconcile.
 */
export type SaveWorkspaceResult =
  | {
      readonly ok: true;
      readonly workspace: StoredWorkspace;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-workspace";
      readonly issues: readonly WorkspaceValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly reason: "not-found";
    }
  | {
      readonly ok: false;
      readonly reason: "revision-conflict";
      readonly actualRevision: number;
    };

/** Metadata-only rename still creates a normal immutable revision. */
export type RenameWorkspaceResult = SaveWorkspaceResult | { readonly ok: false; readonly reason: "invalid-name" | "name-conflict" };

export type DeleteWorkspaceResult =
  | { readonly ok: true; readonly deletedAssetIds: readonly string[] }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "last-workspace" }
  | { readonly ok: false; readonly reason: "revision-conflict"; readonly actualRevision: number };

/**
 * Default per-workspace revision retention: after every save the same
 * transaction prunes revisions older than the newest minus this count.
 * The current revision is never a pruning candidate.
 */
export const DEFAULT_MAX_REVISIONS_PER_WORKSPACE = 50;

/** Options for {@link createWorkspaceRepository}. */
export interface WorkspaceRepositoryOptions {
  /** Stage filesystem cleanup while the SQLite write lock protects references. */
  readonly prepareAssetCleanup?: (ids: readonly string[]) => { commit(): void; rollback(): void };
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
  /**
   * Revisions retained per workspace (integer >= 1); the server wires its
   * env-resolved limit here, tests inject small values. Defaults to
   * {@link DEFAULT_MAX_REVISIONS_PER_WORKSPACE}.
   */
  readonly maxRevisionsPerWorkspace?: number;
}
