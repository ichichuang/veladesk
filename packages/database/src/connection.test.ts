import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { openDatabase } from "./connection";
import { createTempDatabaseFile } from "./test-support";

const tempFile = createTempDatabaseFile("connection-pragmas.db");

afterAll(() => {
  tempFile.cleanup();
});

describe("openDatabase", () => {
  it("opens an in-memory database and can execute select 1", () => {
    const database = openDatabase({ filename: ":memory:" });

    expect(database.sqlite.prepare("select 1 as one").get()).toEqual({ one: 1 });

    database.close();
  });

  it("exposes a working drizzle orm instance", () => {
    const database = openDatabase({ filename: ":memory:" });

    expect(database.orm.get<{ one: number }>(sql`select 1 as one`)).toEqual({ one: 1 });

    database.close();
  });

  it("close() closes the underlying sqlite handle", () => {
    const database = openDatabase({ filename: ":memory:" });
    database.close();

    expect(() => database.sqlite.prepare("select 1")).toThrow();
  });

  it("enables WAL journal mode for file-backed databases", () => {
    const database = openDatabase({ filename: tempFile.filename });

    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");

    database.close();
  });

  it("does not require memory databases to report wal", () => {
    const database = openDatabase({ filename: ":memory:" });

    // SQLite cannot put a :memory: database into WAL; journal_mode returns
    // "memory" there. This is expected and must not fail tests.
    expect(database.sqlite.pragma("journal_mode", { simple: true })).toBe("memory");

    database.close();
  });

  it("enables foreign key enforcement", () => {
    const database = openDatabase({ filename: ":memory:" });

    expect(database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);

    database.close();
  });

  it("sets a 5000 ms busy timeout", () => {
    const database = openDatabase({ filename: ":memory:" });

    expect(database.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);

    database.close();
  });

  it("sets synchronous to NORMAL", () => {
    const database = openDatabase({ filename: ":memory:" });

    expect(database.sqlite.pragma("synchronous", { simple: true })).toBe(1);

    database.close();
  });
});
