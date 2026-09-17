import { afterAll, describe, expect, it } from "vitest";

import { openDatabase } from "./connection";
import { applyMigrations } from "./migrations";
import { MIGRATIONS_FOLDER, createTempDatabaseFile } from "./test-support";
import type { VelaDeskDatabase } from "./connection";

function openedMigratedDatabase(filename: string): VelaDeskDatabase {
  const database = openDatabase({ filename });
  applyMigrations(database, MIGRATIONS_FOLDER);
  return database;
}

describe("applyMigrations", () => {
  it("applies the committed migrations to an empty file-backed database", () => {
    const tempFile = createTempDatabaseFile("empty-apply.db");
    const database = openDatabase({ filename: tempFile.filename });

    expect(() => applyMigrations(database, MIGRATIONS_FOLDER)).not.toThrow();

    database.close();
    tempFile.cleanup();
  });

  it("creates the workspaces table", () => {
    const tempFile = createTempDatabaseFile("tables.db");
    const database = openedMigratedDatabase(tempFile.filename);

    const tables = database.sqlite
      .prepare("select name from sqlite_master where type = 'table' and name = 'workspaces'")
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual(["workspaces"]);

    database.close();
    tempFile.cleanup();
  });

  it("creates the workspace_revisions table", () => {
    const tempFile = createTempDatabaseFile("tables.db");
    const database = openedMigratedDatabase(tempFile.filename);

    const tables = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name = 'workspace_revisions'",
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual(["workspace_revisions"]);

    database.close();
    tempFile.cleanup();
  });

  it("is idempotent: applying again neither fails nor re-runs migrations", () => {
    const tempFile = createTempDatabaseFile("idempotent.db");
    const database = openedMigratedDatabase(tempFile.filename);

    const appliedBefore = (
      database.sqlite
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as { count: number }
    ).count;

    expect(() => applyMigrations(database, MIGRATIONS_FOLDER)).not.toThrow();

    const appliedAfter = (
      database.sqlite
        .prepare("select count(*) as count from __drizzle_migrations")
        .get() as { count: number }
    ).count;

    expect(appliedAfter).toBe(appliedBefore);

    database.close();
    tempFile.cleanup();
  });

  it("enforces the workspace_revisions foreign key with cascade delete", () => {
    const tempFile = createTempDatabaseFile("cascade.db");
    const database = openedMigratedDatabase(tempFile.filename);

    database.sqlite
      .prepare(
        "insert into workspaces (id, name, revision, snapshot_version, snapshot_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("ws-1", "My Desk", 1, 1, "{}", 1000, 1000);
    database.sqlite
      .prepare(
        "insert into workspace_revisions (workspace_id, revision, snapshot_version, snapshot_json, created_at) values (?, ?, ?, ?, ?)",
      )
      .run("ws-1", 1, 1, "{}", 1000);

    database.sqlite.prepare("delete from workspaces where id = ?").run("ws-1");

    const remaining = (
      database.sqlite
        .prepare("select count(*) as count from workspace_revisions where workspace_id = ?")
        .get("ws-1") as { count: number }
    ).count;

    expect(remaining).toBe(0);

    database.close();
    tempFile.cleanup();
  });
});

describe("migration artifacts", () => {
  const tempFile = createTempDatabaseFile("artifacts.db");

  afterAll(() => {
    tempFile.cleanup();
  });

  it("runs on an in-memory database too", () => {
    const database = openedMigratedDatabase(":memory:");

    expect(database.sqlite.prepare("select count(*) as count from workspaces").get()).toEqual({
      count: 0,
    });

    database.close();
  });
});
