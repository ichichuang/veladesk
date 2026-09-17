import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/** Options for {@link openDatabase}. */
export interface OpenDatabaseOptions {
  readonly filename: string;
}

/**
 * An open VelaDesk SQLite database: the raw better-sqlite3 handle plus the
 * Drizzle orm instance built on it.
 *
 * This is an internal package, not a security boundary, so both handles are
 * exposed read-only. The Drizzle schema tables themselves stay
 * package-internal and are not exported from the public index.
 */
export interface VelaDeskDatabase {
  readonly sqlite: Database.Database;
  readonly orm: BetterSQLite3Database;
  close(): void;
}

/**
 * Opens a SQLite database with the VelaDesk pragmas applied:
 * WAL journaling, enforced foreign keys, a 5 s busy timeout and NORMAL
 * synchronous mode (the safe pairing for WAL on a local disk).
 *
 * The database file must live on a local filesystem — WAL does not work on
 * NFS/SMB/network mounts by design. `:memory:` databases are supported
 * (for tests) and report `journal_mode = memory`, which is expected.
 */
export function openDatabase(options: OpenDatabaseOptions): VelaDeskDatabase {
  const sqlite = new Database(options.filename);

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");

  return {
    sqlite,
    orm: drizzle(sqlite),
    close() {
      sqlite.close();
    },
  };
}
