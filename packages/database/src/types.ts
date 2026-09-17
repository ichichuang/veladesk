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
      readonly reason: "already-exists";
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

/** Options for {@link createWorkspaceRepository}. */
export interface WorkspaceRepositoryOptions {
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  readonly now?: () => number;
}
