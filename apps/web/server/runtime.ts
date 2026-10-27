import path from "node:path";
import { prepareWorkspaceAssetCleanup, recoverWorkspaceAssetCleanup } from "./assets/workspace-cleanup";
import { mkdirSync } from "node:fs";

import {
  applyMigrations,
  createWorkspaceRepository,
  openDatabase,
} from "@veladesk/database";
import type { VelaDeskDatabase, WorkspaceRepository } from "@veladesk/database";

import { createAssetUploadGuard } from "./assets/upload-guard";
import { createFilesystemAssetRepository } from "./assets/repository";
import type { AssetRepository } from "./assets/repository";
import type { AssetUploadGuard } from "./api/write-guard";
import { resolveServerConfig } from "./config";
import { LIMITS } from "./limits";
import { createDataDirSizeGuard } from "./storage-guard";
import type { DataDirSizeGuard } from "./storage-guard";

/**
 * One process-wide server runtime: an open SQLite database plus the
 * workspace repository built on it.
 */
export interface WorkspaceServerRuntime {
  readonly database: VelaDeskDatabase;
  readonly repository: WorkspaceRepository;
}

/**
 * Creates a runtime: ensures the data dir exists, opens SQLite, applies the
 * committed migrations and builds the repository.
 *
 * If opening or migrating fails, the database handle is closed again before
 * the error rethrows — a half-initialized runtime is never returned and
 * never cached.
 */
export function createWorkspaceServerRuntime(config: {
  readonly dataDir: string;
  readonly databasePath: string;
  readonly migrationsDir: string;
  readonly assetsDir?: string;
}): WorkspaceServerRuntime {
  mkdirSync(config.dataDir, { recursive: true });

  const database = openDatabase({ filename: config.databasePath });
  try {
    applyMigrations(database, config.migrationsDir);
    recoverWorkspaceAssetCleanup(database, config.assetsDir ?? path.join(config.dataDir, "assets"));
  } catch (error) {
    database.close();
    throw error;
  }

  const assetsDir = config.assetsDir ?? path.join(config.dataDir, "assets");
  return { database, repository: createWorkspaceRepository(database, {
    prepareAssetCleanup: ids => prepareWorkspaceAssetCleanup(assetsDir, ids),
    maxRevisionsPerWorkspace: LIMITS.maxRevisionsPerWorkspace,
  }) };
}

/**
 * Lazily created process singleton.
 *
 * Next.js may evaluate route modules multiple times across dev HMR reloads,
 * so the runtime lives on `globalThis` and survives module re-instantiation:
 * one SQLite connection per process, migrations applied once. Initialization
 * is lazy on purpose — importing this module (as `next build` does) must not
 * touch the filesystem or resolve production config, so builds succeed
 * without any VELADESK_* environment.
 */
interface VelaDeskGlobalThis {
  __veladeskWorkspaceServerRuntime?: WorkspaceServerRuntime;
}

export function getWorkspaceServerRuntime(): WorkspaceServerRuntime {
  const globalThisWithRuntime = globalThis as VelaDeskGlobalThis;
  const existing = globalThisWithRuntime.__veladeskWorkspaceServerRuntime;
  if (existing !== undefined) {
    return existing;
  }

  const runtime = createWorkspaceServerRuntime(
    resolveServerConfig(process.env, process.cwd()),
  );
  globalThisWithRuntime.__veladeskWorkspaceServerRuntime = runtime;
  return runtime;
}

/** Repository accessor for route handlers. */
export function getWorkspaceRepository(): WorkspaceRepository {
  return getWorkspaceServerRuntime().repository;
}

interface VelaDeskAssetsGlobalThis {
  __veladeskAssetRepository?: AssetRepository;
}

/**
 * Lazily created asset repository singleton: files land in
 * `${VELADESK_DATA_DIR}/assets/`, created on first write. Like the
 * workspace runtime above, configuration is resolved only when a request
 * actually needs it — importing route modules never touches the
 * filesystem or the environment.
 */
export function getAssetRepository(): AssetRepository {
  const globalThisWithAssets = globalThis as VelaDeskAssetsGlobalThis;
  const existing = globalThisWithAssets.__veladeskAssetRepository;
  if (existing !== undefined) {
    return existing;
  }
  const config = resolveServerConfig(process.env, process.cwd());
  const repository = createFilesystemAssetRepository({ assetsDir: config.assetsDir });
  globalThisWithAssets.__veladeskAssetRepository = repository;
  return repository;
}

interface VelaDeskGuardsGlobalThis {
  __veladeskDataDirSizeGuard?: DataDirSizeGuard;
  __veladeskAssetUploadGuard?: AssetUploadGuard;
}

/**
 * Lazily created data-dir size guard singleton (task vd-guard): the
 * mutating workspace routes share it, so the recursive size measurement
 * is cached process-wide for the check TTL.
 */
export function getDataDirSizeGuard(): DataDirSizeGuard {
  const globalThisWithGuards = globalThis as VelaDeskGuardsGlobalThis;
  const existing = globalThisWithGuards.__veladeskDataDirSizeGuard;
  if (existing !== undefined) {
    return existing;
  }
  const config = resolveServerConfig(process.env, process.cwd());
  const guard = createDataDirSizeGuard({
    dataDir: config.dataDir,
    maxBytes: LIMITS.maxDataDirBytes,
    ttlMs: LIMITS.dataDirCheckTtlMs,
  });
  globalThisWithGuards.__veladeskDataDirSizeGuard = guard;
  return guard;
}

/**
 * Lazily created asset-upload guard singleton (task vd-guard): composes
 * the data-dir budget with the assets-dir quota and the lazy orphan
 * cleanup. The cleanup shares the workspace runtime's SQLite connection
 * so it reads references under the same write lock the saves take.
 */
export function getAssetUploadGuard(): AssetUploadGuard {
  const globalThisWithGuards = globalThis as VelaDeskGuardsGlobalThis;
  const existing = globalThisWithGuards.__veladeskAssetUploadGuard;
  if (existing !== undefined) {
    return existing;
  }
  const config = resolveServerConfig(process.env, process.cwd());
  const guard = createAssetUploadGuard({
    database: getWorkspaceServerRuntime().database,
    assetsDir: config.assetsDir,
    storage: getDataDirSizeGuard(),
    maxAssetCount: LIMITS.maxAssetCount,
    maxAssetTotalBytes: LIMITS.maxAssetTotalBytes,
    orphanGraceMs: LIMITS.orphanGraceMs,
    orphanSweepIntervalMs: LIMITS.orphanSweepIntervalMs,
  });
  globalThisWithGuards.__veladeskAssetUploadGuard = guard;
  return guard;
}
