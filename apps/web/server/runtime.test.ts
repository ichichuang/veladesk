import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createEmptyWorkspace } from "@veladesk/domain";
import { describe, expect, it } from "vitest";

import { createWorkspaceServerRuntime } from "./runtime";

/** The committed Drizzle migration folder of the monorepo. */
const realMigrationsDir = fileURLToPath(
  new URL("../../../packages/database/drizzle", import.meta.url),
);

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `veladesk-${prefix}-`));
}

/** A migrations folder whose journal points at syntactically broken SQL. */
function makeBrokenMigrationsDir(): string {
  const dir = makeTempDir("broken-migrations");
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        { idx: 0, version: "6", when: 0, tag: "0000_broken", breakpoints: true },
      ],
    }),
  );
  writeFileSync(path.join(dir, "0000_broken.sql"), "CREATE TABEL nope;");
  return dir;
}

describe("createWorkspaceServerRuntime", () => {
  it("creates the data dir, the SQLite file, applies migrations and serves a repository", () => {
    const dataDir = makeTempDir("runtime");
    try {
      const databasePath = path.join(dataDir, "nested", "veladesk.db");
      const runtime = createWorkspaceServerRuntime({
        dataDir: path.join(dataDir, "nested"),
        databasePath,
        migrationsDir: realMigrationsDir,
      });

      try {
        expect(existsSync(databasePath)).toBe(true);

        const tables = runtime.database.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as ReadonlyArray<{ name: string }>;
        const tableNames = tables.map((table) => table.name);
        expect(tableNames).toContain("workspaces");
        expect(tableNames).toContain("workspace_revisions");

        const snapshot = createEmptyWorkspace({
          workspaceId: "ws-runtime",
          workspaceName: "Runtime Desk",
          pageId: "page-1",
          pageName: "Home",
          grid: { columns: 12, rows: 8 },
        });
        const created = runtime.repository.createWorkspace(snapshot);
        expect(created.ok).toBe(true);
        expect(runtime.repository.loadWorkspace("ws-runtime")?.snapshot).toEqual(snapshot);
      } finally {
        runtime.database.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("closes the database connection when migrations fail", () => {
    const dataDir = makeTempDir("runtime-failure");
    const migrationsDir = makeBrokenMigrationsDir();
    try {
      expect(() =>
        createWorkspaceServerRuntime({
          dataDir,
          databasePath: path.join(dataDir, "veladesk.db"),
          migrationsDir,
        }),
      ).toThrowError();

      // A cleanly closed SQLite connection checkpoints and removes its WAL
      // sidecar files; leftover sidecars would mean a leaked connection.
      expect(existsSync(path.join(dataDir, "veladesk.db-wal"))).toBe(false);
      expect(existsSync(path.join(dataDir, "veladesk.db-shm"))).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(migrationsDir, { recursive: true, force: true });
    }
  });
});
