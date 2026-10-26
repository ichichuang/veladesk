import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { applyMigrations, createWorkspaceRepository, openDatabase, type VelaDeskDatabase, type WorkspaceRepository } from "@veladesk/database";
import { createEmptyWorkspace } from "@veladesk/domain";
import { handleCreateWorkspace, handleDeleteWorkspace, handleRenameWorkspace } from "./workspace-handlers";

let database: VelaDeskDatabase;
let repository: WorkspaceRepository;
const migrations = fileURLToPath(new URL("../../../../packages/database/drizzle", import.meta.url));
function snapshot(id: string) { return createEmptyWorkspace({ workspaceId: id, workspaceName: id, pageId: `${id}-page`, pageName: "Home", grid: { columns: 5, rows: 6 } }); }
function request(method: string, body: unknown) { return new Request("http://localhost/api/v1/workspaces/work", { method, body: JSON.stringify(body) }); }
beforeEach(() => { database = openDatabase({ filename: ":memory:" }); applyMigrations(database, migrations); repository = createWorkspaceRepository(database); repository.createWorkspace(snapshot("work")); });
afterEach(() => database.close());
async function error(response: Response, status: number, code: string) { expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ error: { code } }); }

describe("workspace management API", () => {
  it("PATCH returns the canonical snapshot and a new revision", async () => {
    const response = await handleRenameWorkspace(repository, request("PATCH", { name: "Office", expectedRevision: 1 }), "work");
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ workspace: { snapshot: { name: "Office" }, revision: 2 } });
  });
  it.each(["", "  ", "x".repeat(41)])("PATCH validates name %j", async name => error(await handleRenameWorkspace(repository, request("PATCH", { name, expectedRevision: 1 }), "work"), 422, "invalid-workspace-name"));
  it("PATCH returns a stable duplicate-name code", async () => {
    repository.createWorkspace(snapshot("home"));
    await error(await handleRenameWorkspace(repository, request("PATCH", { name: "home", expectedRevision: 1 }), "work"), 409, "workspace-name-conflict");
  });
  it("PATCH refuses malformed envelopes and revisions", async () => {
    await error(await handleRenameWorkspace(repository, request("PATCH", { name: 123, expectedRevision: 1 }), "work"), 400, "invalid-request");
    await error(await handleRenameWorkspace(repository, request("PATCH", { name: "Name", expectedRevision: 0 }), "work"), 400, "invalid-revision");
    await error(await handleRenameWorkspace(repository, new Request("http://localhost", { method: "PATCH", body: "{" }), "work"), 400, "invalid-json");
  });
  it("PATCH reports missing workspaces and actual conflict revision", async () => {
    await error(await handleRenameWorkspace(repository, request("PATCH", { name: "Name", expectedRevision: 1 }), "missing"), 404, "workspace-not-found");
    const response = await handleRenameWorkspace(repository, request("PATCH", { name: "Name", expectedRevision: 2 }), "work");
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: { code: "revision-conflict", actualRevision: 1 } });
  });
  it("DELETE refuses the only workspace with a stable 409", async () => error(await handleDeleteWorkspace(repository, request("DELETE", { expectedRevision: 1 }), "work"), 409, "last-workspace"));
  it("DELETE returns 204 and removes history", async () => {
    repository.createWorkspace(snapshot("home"));
    const response = await handleDeleteWorkspace(repository, request("DELETE", { expectedRevision: 1 }), "work");
    expect(response.status).toBe(204); expect(await response.text()).toBe(""); expect(repository.listWorkspaceRevisions("work")).toEqual([]);
  });
  it("DELETE checks revision and preserves newer content", async () => {
    repository.createWorkspace(snapshot("home")); repository.renameWorkspace("work", "Office", 1);
    const response = await handleDeleteWorkspace(repository, request("DELETE", { expectedRevision: 1 }), "work");
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: { code: "revision-conflict", actualRevision: 2 } });
    expect(repository.loadWorkspace("work")).toBeDefined();
  });
  it("DELETE rejects malformed revision and missing id", async () => {
    await error(await handleDeleteWorkspace(repository, request("DELETE", {}), "work"), 400, "invalid-revision");
    await error(await handleDeleteWorkspace(repository, request("DELETE", { expectedRevision: 1 }), "missing"), 404, "workspace-not-found");
  });
  it("POST enforces the workspace cap", async () => {
    for (let index = 1; index < 10; index++) repository.createWorkspace(snapshot(`desk-${index}`));
    await error(await handleCreateWorkspace(repository, request("POST", { snapshot: snapshot("extra") })), 409, "workspace-limit");
  });
  it("POST applies the same 40 character bound", async () => {
    await error(await handleCreateWorkspace(repository, request("POST", { snapshot: { ...snapshot("extra"), name: "x".repeat(41) } })), 422, "invalid-workspace");
  });
});
