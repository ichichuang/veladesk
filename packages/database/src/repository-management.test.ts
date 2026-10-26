import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import { createWorkspaceRepository } from "./repository";
import { createRepositoryContext, type RepositoryTestContext } from "./repository-fixtures";

const contexts: RepositoryTestContext[] = [];
afterEach(() => { contexts.splice(0).forEach(context => context.cleanup()); });
function setup() { const context = createRepositoryContext(); contexts.push(context); return context; }
function snapshot(id: string, assetId?: string): WorkspaceSnapshot {
  const base = createEmptyWorkspace({ workspaceId: id, workspaceName: id, pageId: `${id}-page`, pageName: "Home", grid: { columns: 5, rows: 6 } });
  return assetId === undefined ? base : { ...base, entities: [{ kind: "app", id: `${id}-app`, name: "App", url: "https://example.com", icon: { kind: "asset", assetId }, openMode: "new-tab", tags: [] }] };
}

describe("workspace management transactions", () => {
  it("renames both listing and snapshot and appends an immutable revision", () => {
    const { repository } = setup();
    repository.createWorkspace(snapshot("work"));
    expect(repository.renameWorkspace("work", "  Office  ", 1)).toMatchObject({ ok: true, workspace: { revision: 2, snapshot: { name: "Office" } } });
    expect(repository.listWorkspaces()[0]?.name).toBe("Office");
    expect(repository.loadWorkspaceRevision("work", 1)?.snapshot.name).toBe("work");
    expect(repository.loadWorkspaceRevision("work", 2)?.snapshot.name).toBe("Office");
  });
  it.each(["", "  ", "a".repeat(41)])("refuses invalid rename %j without a revision", name => {
    const { repository } = setup(); repository.createWorkspace(snapshot("work"));
    expect(repository.renameWorkspace("work", name)).toEqual({ ok: false, reason: "invalid-name" });
    expect(repository.listWorkspaceRevisions("work")).toHaveLength(1);
  });
  it("guards missing, duplicate and stale renames", () => {
    const { repository } = setup(); repository.createWorkspace(snapshot("work")); repository.createWorkspace(snapshot("home"));
    expect(repository.renameWorkspace("missing", "Name")).toEqual({ ok: false, reason: "not-found" });
    expect(repository.renameWorkspace("work", "home")).toEqual({ ok: false, reason: "name-conflict" });
    repository.renameWorkspace("work", "Office", 1);
    expect(repository.renameWorkspace("work", "Stale", 1)).toEqual({ ok: false, reason: "revision-conflict", actualRevision: 2 });
  });
  it("refuses deletion of the last workspace and stale or missing ids", () => {
    const { repository } = setup(); repository.createWorkspace(snapshot("work"));
    expect(repository.deleteWorkspace("work")).toEqual({ ok: false, reason: "last-workspace" });
    expect(repository.deleteWorkspace("missing")).toEqual({ ok: false, reason: "not-found" });
    repository.createWorkspace(snapshot("home"));
    expect(repository.deleteWorkspace("work", 2)).toEqual({ ok: false, reason: "revision-conflict", actualRevision: 1 });
  });
  it("enforces ten workspaces atomically, allowing replacement after deletion", () => {
    const { repository } = setup();
    for (let i = 0; i < 10; i++) expect(repository.createWorkspace(snapshot(`desk-${i}`)).ok).toBe(true);
    expect(repository.createWorkspace(snapshot("extra"))).toEqual({ ok: false, reason: "workspace-limit" });
    expect(repository.createWorkspace(snapshot("desk-0"))).toEqual({ ok: false, reason: "already-exists" });
    repository.deleteWorkspace("desk-0");
    expect(repository.createWorkspace(snapshot("extra")).ok).toBe(true);
  });
  it("deletes revisions and only exclusive asset references, including historical wallpaper references", () => {
    const { database } = setup();
    const commit = vi.fn(), rollback = vi.fn();
    const prepareAssetCleanup = vi.fn(() => ({ commit, rollback }));
    const repository = createWorkspaceRepository(database, { prepareAssetCleanup });
    repository.createWorkspace(snapshot("work", "exclusive"));
    repository.saveWorkspace(snapshot("work", "shared"), 1);
    const home = snapshot("home");
    repository.createWorkspace({ ...home, pages: home.pages.map(page => ({ ...page, wallpaper: { kind: "asset", assetId: "shared", fit: "cover", position: "center" } })) });
    repository.saveWorkspace(home, 1); // Only a retained revision references shared.
    expect(repository.deleteWorkspace("work", 2)).toEqual({ ok: true, deletedAssetIds: ["exclusive"] });
    expect(prepareAssetCleanup).toHaveBeenCalledWith(["exclusive"]);
    expect(commit).toHaveBeenCalledOnce(); expect(rollback).not.toHaveBeenCalled();
    expect(repository.loadWorkspace("work")).toBeUndefined();
    expect(repository.listWorkspaceRevisions("work")).toEqual([]);
    expect(repository.loadWorkspaceRevision("home", 1)).toBeDefined();
  });
  it("rolls back workspace, revisions and asset staging if SQL deletion fails", () => {
    const { database } = setup();
    const commit = vi.fn(), rollback = vi.fn();
    const repository = createWorkspaceRepository(database, { prepareAssetCleanup: () => ({ commit, rollback }) });
    repository.createWorkspace(snapshot("work", "exclusive")); repository.createWorkspace(snapshot("home"));
    database.sqlite.exec("CREATE TRIGGER refuse_delete BEFORE DELETE ON workspaces BEGIN SELECT RAISE(ABORT, 'refused'); END;");
    expect(() => repository.deleteWorkspace("work")).toThrow("refused");
    expect(rollback).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
    expect(repository.loadWorkspace("work")).toBeDefined(); expect(repository.listWorkspaceRevisions("work")).toHaveLength(1);
  });
});
