import { mkdirSync } from "node:fs";

import {
  applyMigrations,
  createWorkspaceRepository,
  openDatabase,
} from "@veladesk/database";
import type { VelaDeskDatabase, WorkspaceRepository } from "@veladesk/database";

import { createFilesystemAssetRepository } from "./assets/repository";
import type { AssetRepository } from "./assets/repository";
import { resolveServerConfig } from "./config";

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
}): WorkspaceServerRuntime {
  mkdirSync(config.dataDir, { recursive: true });

  const database = openDatabase({ filename: config.databasePath });
  try {
    applyMigrations(database, config.migrationsDir);
  } catch (error) {
    database.close();
    throw error;
  }

  return { database, repository: createWorkspaceRepository(database) };
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
