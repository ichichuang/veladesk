/**
 * Public API of @veladesk/database.
 *
 * Explicit named exports only — no `export *`. The Drizzle schema tables
 * and the serialization helpers stay package-internal on purpose.
 */

export { openDatabase } from "./connection";
export type { OpenDatabaseOptions, VelaDeskDatabase } from "./connection";

export { applyMigrations } from "./migrations";
