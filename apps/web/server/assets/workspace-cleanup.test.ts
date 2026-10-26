import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations, createWorkspaceRepository, openDatabase } from "@veladesk/database";
import { createEmptyWorkspace } from "@veladesk/domain";
import { prepareWorkspaceAssetCleanup, recoverWorkspaceAssetCleanup } from "./workspace-cleanup";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function directory() { const dir = mkdtempSync(path.join(tmpdir(), "workspace-assets-")); directories.push(dir); return dir; }
const asset = `asset-sha256-${"a".repeat(64)}`;

describe("workspace filesystem cleanup", () => {
  it("quarantines only valid content ids, restores on rollback, and unlinks on commit", () => {
    const dir = directory(); const file = path.join(dir, `${asset}.bin`); writeFileSync(file, "bytes");
    const staged = prepareWorkspaceAssetCleanup(dir, [asset, "../unsafe"]);
    expect(existsSync(file)).toBe(false); expect(readdirSync(dir)).toHaveLength(1);
    staged.rollback(); expect(existsSync(file)).toBe(true);
    prepareWorkspaceAssetCleanup(dir, [asset]).commit(); expect(readdirSync(dir)).toEqual([]);
  });
  it.each([true, false])("recovers a process crash with committed reference=%s", referenced => {
    const dir = directory(); const file = path.join(dir, `${asset}.bin`); writeFileSync(file, "bytes");
    prepareWorkspaceAssetCleanup(dir, [asset]);
    const database = openDatabase({ filename: ":memory:" });
    try {
      applyMigrations(database, fileURLToPath(new URL("../../../../packages/database/drizzle", import.meta.url)));
      if (referenced) {
        const workspace = createEmptyWorkspace({ workspaceId: "work", workspaceName: "Work", pageId: "page", pageName: "Home", grid: { columns: 5, rows: 6 } });
        const repository = createWorkspaceRepository(database);
        repository.createWorkspace({ ...workspace, pages: workspace.pages.map(page => ({ ...page, wallpaper: { kind: "asset", assetId: asset, fit: "cover", position: "center" } })) });
      }
      recoverWorkspaceAssetCleanup(database, dir);
      expect(existsSync(file)).toBe(referenced); expect(readdirSync(dir).some(name => name.startsWith(".workspace-trash-"))).toBe(false);
    } finally { database.close(); }
  });
});
