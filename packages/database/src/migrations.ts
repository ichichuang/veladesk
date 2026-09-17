import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { VelaDeskDatabase } from "./connection";

/**
 * Applies the committed Drizzle SQL migrations from `migrationsFolder`.
 *
 * The folder is an explicit argument on purpose: how migration SQL ships
 * with a deployment (Docker image, standalone build) is a packaging
 * decision that later tasks must make deliberately instead of relying on
 * a hidden default path.
 */
export function applyMigrations(database: VelaDeskDatabase, migrationsFolder: string): void {
  migrate(database.orm, { migrationsFolder });
}
