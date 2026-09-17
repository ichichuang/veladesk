import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

/**
 * Shared helpers for database tests: temp SQLite files and the location of
 * the committed migration folder. Tests must always run against the real
 * generated migrations under packages/database/drizzle — never hand-written
 * CREATE TABLE statements.
 */

/** Absolute path of the committed drizzle migration folder. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Creates a unique temp directory; returns it with a cleanup function. */
export function createTempDirectory(): { readonly dir: string; readonly cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "veladesk-database-test-"));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A fresh SQLite file path inside its own temp directory. */
export function createTempDatabaseFile(name = "workspace.db"): {
  readonly filename: string;
  readonly cleanup: () => void;
} {
  const { dir, cleanup } = createTempDirectory();
  return { filename: join(dir, name), cleanup };
}
