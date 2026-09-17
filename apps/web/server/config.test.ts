import { describe, expect, it } from "vitest";

import { resolveServerConfig } from "./config";

const APP_CWD = "/repo/apps/web";

describe("resolveServerConfig: development defaults", () => {
  it("defaults data dir and migrations dir to the apps/web conventions", () => {
    const config = resolveServerConfig({ NODE_ENV: "development" }, APP_CWD);

    expect(config.dataDir).toBe("/repo/apps/web/.veladesk-data");
    expect(config.migrationsDir).toBe("/repo/packages/database/drizzle");
  });

  it("still applies defaults when NODE_ENV is unset (test environment)", () => {
    const config = resolveServerConfig({}, APP_CWD);

    expect(config.dataDir).toBe("/repo/apps/web/.veladesk-data");
    expect(config.migrationsDir).toBe("/repo/packages/database/drizzle");
  });

  it("derives the database path from the data dir", () => {
    const config = resolveServerConfig({}, APP_CWD);

    expect(config.databasePath).toBe("/repo/apps/web/.veladesk-data/veladesk.db");
  });

  it("uses explicitly provided env paths in development", () => {
    const config = resolveServerConfig(
      {
        NODE_ENV: "development",
        VELADESK_DATA_DIR: "/srv/veladesk",
        VELADESK_MIGRATIONS_DIR: "/srv/migrations",
      },
      APP_CWD,
    );

    expect(config.dataDir).toBe("/srv/veladesk");
    expect(config.migrationsDir).toBe("/srv/migrations");
  });
});

describe("resolveServerConfig: relative env paths", () => {
  it("resolves a relative data dir against the given cwd", () => {
    const config = resolveServerConfig({ VELADESK_DATA_DIR: "data/live" }, APP_CWD);

    expect(config.dataDir).toBe("/repo/apps/web/data/live");
    expect(config.databasePath).toBe("/repo/apps/web/data/live/veladesk.db");
  });

  it("resolves a relative migrations dir against the given cwd", () => {
    const config = resolveServerConfig({ VELADESK_MIGRATIONS_DIR: "../shared/drizzle" }, APP_CWD);

    expect(config.migrationsDir).toBe("/repo/apps/shared/drizzle");
  });
});

describe("resolveServerConfig: blank env values", () => {
  it("rejects a blank VELADESK_DATA_DIR instead of treating it as unset", () => {
    expect(() => resolveServerConfig({ VELADESK_DATA_DIR: "   " }, APP_CWD)).toThrowError(
      /VELADESK_DATA_DIR/,
    );
  });

  it("rejects a blank VELADESK_MIGRATIONS_DIR instead of treating it as unset", () => {
    expect(() => resolveServerConfig({ VELADESK_MIGRATIONS_DIR: "" }, APP_CWD)).toThrowError(
      /VELADESK_MIGRATIONS_DIR/,
    );
  });
});

describe("resolveServerConfig: production requirements", () => {
  const production = { NODE_ENV: "production" } as const;

  it("rejects production without VELADESK_DATA_DIR", () => {
    expect(() =>
      resolveServerConfig(
        { ...production, VELADESK_MIGRATIONS_DIR: "/srv/migrations" },
        APP_CWD,
      ),
    ).toThrowError(/VELADESK_DATA_DIR/);
  });

  it("rejects production without VELADESK_MIGRATIONS_DIR", () => {
    expect(() =>
      resolveServerConfig({ ...production, VELADESK_DATA_DIR: "/srv/veladesk" }, APP_CWD),
    ).toThrowError(/VELADESK_MIGRATIONS_DIR/);
  });

  it("rejects production without either variable, naming the first missing one", () => {
    expect(() => resolveServerConfig(production, APP_CWD)).toThrowError(/VELADESK_DATA_DIR/);
  });

  it("resolves both explicit paths in production", () => {
    const config = resolveServerConfig(
      {
        ...production,
        VELADESK_DATA_DIR: "/srv/veladesk",
        VELADESK_MIGRATIONS_DIR: "/srv/veladesk/migrations",
      },
      APP_CWD,
    );

    expect(config.dataDir).toBe("/srv/veladesk");
    expect(config.migrationsDir).toBe("/srv/veladesk/migrations");
    expect(config.databasePath).toBe("/srv/veladesk/veladesk.db");
  });
});
