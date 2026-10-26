// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { validateWorkspace, type WorkspaceSnapshot } from "@veladesk/domain";
import type { WorkspaceCandidate } from "@veladesk/client-runtime";
import { useI18n } from "../i18n/use-i18n";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { WorkspaceDialog } from "./workspace-dialog";
vi.mock("@components/vd/reduced-motion", () => ({ useVdReducedMotion: () => true }));
afterEach(() => { cleanup(); localStorage.clear(); });
const candidates: readonly WorkspaceCandidate[] = [{ source: "remote", id: "work", name: "工作区 1", revision: 1 }, { source: "remote", id: "home", name: "在家", revision: 1 }];
function LocaleSwitch() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("en-US")}>English</button>; }
function setup(workspace?: WorkspaceCandidate) {
  const onCreate = vi.fn(async (_snapshot: WorkspaceSnapshot) => ({ ok: true as const }));
  const onRename = vi.fn(async (_id: string, _name: string) => ({ ok: true as const }));
  const onClose = vi.fn();
  const view = render(<UiLocaleProvider><LocaleSwitch /><WorkspaceDialog candidates={candidates} {...(workspace === undefined ? {} : { workspace })} onCreate={onCreate} onRename={onRename} onClose={onClose} /></UiLocaleProvider>);
  return { view, onCreate, onRename, onClose, input: view.getByRole("textbox", { name: "名称" }) as HTMLInputElement };
}

describe("workspace create and rename dialogs", () => {
  it("defaults to the next unused localized name and blank template", () => {
    const { view, input } = setup(); expect(input.value).toBe("工作区 2"); expect((view.getByRole("radio", { name: "空白" }) as HTMLInputElement).checked).toBe(true);
  });
  it.each(["空白", "示例·前端", "示例·上班", "示例·在家"])("creates a valid %s template", async label => {
    const { view, onCreate, onClose, input } = setup(); fireEvent.change(input, { target: { value: "New Desk" } }); fireEvent.click(view.getByRole("radio", { name: label }));
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce()); const snapshot = onCreate.mock.calls[0]![0];
    expect(snapshot.name).toBe("New Desk"); expect(validateWorkspace(snapshot)).toEqual([]);
    expect(snapshot.entities.length > 0).toBe(label !== "空白"); expect(onClose).toHaveBeenCalledOnce();
  });
  it.each(["", " ", "x".repeat(41)])("validates rename %j before sending", async value => {
    const { view, input, onRename } = setup(candidates[0]); fireEvent.change(input, { target: { value } }); fireEvent.submit(input.closest("form")!);
    expect(view.getByRole("alert").textContent).toContain("1～40"); expect(onRename).not.toHaveBeenCalled();
  });
  it("shows a duplicate-name error and allows correcting it", async () => {
    const { view, input, onRename } = setup(candidates[0]); fireEvent.change(input, { target: { value: "在家" } }); fireEvent.submit(input.closest("form")!);
    expect(view.getByRole("alert").textContent).toContain("同名"); expect(onRename).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "上班" } }); fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("work", "上班")); expect(view.queryByRole("radiogroup")).toBeNull();
  });
  it("Escape cancels the rename and does not send", async () => {
    const { input, onClose, onRename } = setup(candidates[0]); fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce()); expect(onRename).not.toHaveBeenCalled();
  });
  it("uses English default names and template labels in English", async () => {
    const { view } = setup(); fireEvent.click(view.getByText("English")); await waitFor(() => expect(view.queryByRole("radio", { name: "Sample · Work" })).toBeTruthy());
    expect((view.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Workspace 1");
  });
});
