import path from "node:path";

/**
 * Resolved filesystem locations the VelaDesk server persists to and
 * migrates from. Everything is absolute; see {@link resolveServerConfig}.
 */
export interface VelaDeskServerConfig {
  readonly dataDir: string;
  readonly databasePath: string;
  readonly migrationsDir: string;
  /**
   * Uploaded-asset binaries live next to the database, one
   * `<assetId>.bin` per file — the whole data dir is the backup boundary.
   */
  readonly assetsDir: string;
}

/** Environment subset the config resolver reads; injectable for tests. */
export interface ServerEnv {
  readonly NODE_ENV?: string;
  readonly VELADESK_DATA_DIR?: string;
  readonly VELADESK_MIGRATIONS_DIR?: string;
}

const DATA_DIR_VAR = "VELADESK_DATA_DIR";
const MIGRATIONS_DIR_VAR = "VELADESK_MIGRATIONS_DIR";

/**
 * Reads one directory env var.
 *
 * A blank value is rejected even in development: an operator who sets the
 * variable to whitespace meant something, and silently falling back to the
 * default would create data in a surprise location.
 */
function resolveDir(
  value: string | undefined,
  variable: string,
  cwd: string,
  requiredInProduction: boolean,
): string {
  if (value === undefined) {
    if (requiredInProduction) {
      throw new Error(`${variable} must be set when NODE_ENV is production`);
    }
    return "";
  }
  if (value.trim().length === 0) {
    throw new Error(`${variable} is set but blank; provide a non-blank path`);
  }
  return path.resolve(cwd, value);
}

/**
 * Resolves the server config from the environment and a process cwd.
 *
 * Development/test defaults follow the `apps/web` process convention:
 * data lands in `<cwd>/.veladesk-data`, migrations are read from the
 * monorepo's `packages/database/drizzle` (cwd two levels below the root).
 * In production both env vars are required explicitly so a server never
 * silently creates its database relative to an arbitrary launch directory.
 * Relative env paths resolve against `cwd`; values are never trimmed.
 */
export function resolveServerConfig(env: ServerEnv, cwd: string): VelaDeskServerConfig {
  const production = env.NODE_ENV === "production";

  const dataDir =
    resolveDir(env.VELADESK_DATA_DIR, DATA_DIR_VAR, cwd, production) ||
    path.resolve(cwd, ".veladesk-data");
  const migrationsDir =
    resolveDir(env.VELADESK_MIGRATIONS_DIR, MIGRATIONS_DIR_VAR, cwd, production) ||
    path.resolve(cwd, "../../packages/database/drizzle");

  return {
    dataDir,
    databasePath: path.join(dataDir, "veladesk.db"),
    migrationsDir,
    assetsDir: path.join(dataDir, "assets"),
  };
}
