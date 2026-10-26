// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceCandidate } from "@veladesk/client-runtime";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { ContextMenu } from "./context-menu";
import { WorkspaceManagerProvider, WorkspaceMenuInline, useWorkspaceManager } from "./workspace-manager";
const runtime = vi.hoisted(() => ({ listWorkspaces: vi.fn(), selectWorkspace: vi.fn(), createWorkspace: vi.fn(), renameWorkspace: vi.fn(), deleteWorkspace: vi.fn() }));
vi.mock("../workspace-runtime/use-workspace-runtime", () => ({ useWorkspaceRuntimeInstance: () => runtime }));
vi.mock("@components/vd/reduced-motion", () => ({ useVdReducedMotion: () => true }));
const candidates: readonly WorkspaceCandidate[] = [{ source: "remote", id: "work", name: "上班", revision: 1 }, { source: "remote", id: "home", name: "在家", revision: 1 }];
const snapshot = createEmptyWorkspace({ workspaceId: "work", workspaceName: "上班", pageId: "page", pageName: "Home", grid: { columns: 5, rows: 6 } });
const workspace: LocalWorkspaceRecord = { id: "work", snapshot, serverRevision: 1, localGeneration: 0, syncState: "clean", updatedAt: 100, lastSyncedAt: 100 };
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); runtime.listWorkspaces.mockResolvedValue(candidates); for (const method of [runtime.selectWorkspace, runtime.createWorkspace, runtime.renameWorkspace, runtime.deleteWorkspace]) method.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
function Host() {
  const manager = useWorkspaceManager(); const [open, setOpen] = useState(true);
  return <>{open && manager !== null ? <ContextMenu state={{ x: 30, y: 30, entries: [manager.menu] }} onClose={() => setOpen(false)} /> : null}</>;
}
function renderManager(mobile = false) {
  return render(<UiLocaleProvider><WorkspaceManagerProvider workspace={workspace}>{mobile ? <WorkspaceMenuInline beforeAction={() => {}} /> : <Host />}</WorkspaceManagerProvider></UiLocaleProvider>);
}
async function openMenu() {
  const view = renderManager(); await waitFor(() => expect(runtime.listWorkspaces).toHaveBeenCalled());
  fireEvent.click(view.getByRole("menuitem", { name: "工作区" })); await waitFor(() => expect(view.getByRole("menuitemradio", { name: "在家" })).toBeTruthy()); return view;
}

describe("workspace management feedback and confirmation", () => {
  it("shows the name and danger action, cancels without deletion, keeps the data intact", async () => {
    const view = await openMenu(); fireEvent.click(view.getByRole("button", { name: "删除「在家」" }));
    expect(view.getByRole("alertdialog").textContent).toContain("在家");
    expect(view.getByRole("button", { name: "删除工作区" }).className).toContain("bg-vdu-danger");
    fireEvent.click(view.getByRole("button", { name: "取消" })); await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull()); expect(runtime.deleteWorkspace).not.toHaveBeenCalled();
  });
  it("deletes only after explicit confirmation and shows persistent success feedback", async () => {
    const view = await openMenu(); fireEvent.click(view.getByRole("button", { name: "删除「上班」" })); expect(runtime.deleteWorkspace).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "删除工作区" }));
    await waitFor(() => expect(runtime.deleteWorkspace).toHaveBeenCalledWith("work"));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull()); expect(view.getByRole("status").textContent).toContain("已删除「上班」");
  });
  it("keeps the confirmation open with a readable error if deletion fails", async () => {
    runtime.deleteWorkspace.mockResolvedValueOnce({ ok: false, reason: "network-error" });
    const view = await openMenu(); fireEvent.click(view.getByRole("button", { name: "删除「在家」" })); fireEvent.click(view.getByRole("button", { name: "删除工作区" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("网络")); expect(view.getByRole("alertdialog")).toBeTruthy();
    expect(view.queryByRole("status")).toBeNull();
  });
  it("disables the last workspace delete action with an explanation", async () => {
    runtime.listWorkspaces.mockResolvedValue([candidates[0]]); const view = renderManager();
    fireEvent.click(view.getByRole("menuitem", { name: "工作区" }));
    const button = await view.findByRole("button", { name: "删除「上班」" }); expect((button as HTMLButtonElement).disabled).toBe(true); expect(button.title).toContain("至少保留");
  });
  it("opens the new-workspace dialog and keeps it open on server limit failure", async () => {
    runtime.createWorkspace.mockResolvedValueOnce({ ok: false, reason: "workspace-limit" });
    const view = await openMenu(); fireEvent.click(view.getByRole("menuitem", { name: "新增工作区…" }));
    fireEvent.submit(view.getByRole("textbox", { name: "名称" }).closest("form")!);
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("10")); expect(view.getByRole("dialog")).toBeTruthy();
  });
  it("shows a switch toast or a readable flush refusal", async () => {
    runtime.selectWorkspace.mockResolvedValueOnce({ ok: false, reason: "unsaved-changes" });
    const view = await openMenu(); fireEvent.click(view.getByRole("menuitemradio", { name: "在家" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("尚未保存")); expect(runtime.selectWorkspace).toHaveBeenCalledWith("home");
  });
  it("provides touch expansion with current state and the same management actions", async () => {
    const view = renderManager(true); await waitFor(() => expect(runtime.listWorkspaces).toHaveBeenCalled());
    fireEvent.click(view.getByRole("button", { name: "工作区" }));
    const work = await view.findByRole("button", { name: "上班" }); expect(work.getAttribute("aria-current")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "重命名「在家」" })); expect(view.getByRole("dialog").textContent).toContain("重命名工作区");
  });
});
