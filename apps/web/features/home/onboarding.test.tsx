// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { OnboardingScreen } from "./onboarding";

const runtime = vi.hoisted(() => ({ stageWorkspaceCreate: vi.fn(), syncCurrent: vi.fn() }));
vi.mock("../workspace-runtime/use-workspace-runtime", () => ({ useWorkspaceRuntimeInstance: () => runtime }));
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); runtime.syncCurrent.mockResolvedValue({}); });

describe("onboarding creation feedback", () => {
  it("makes the sample primary and only announces the action in progress", async () => {
    let finish!: (result: { ok: boolean }) => void;
    runtime.stageWorkspaceCreate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const onSampleCreated = vi.fn();
    const view = render(<OnboardingScreen onSampleCreated={onSampleCreated} />);
    const sample = view.getByRole("button", { name: "一键体验示例工作区" });
    expect(sample.classList.contains("vela-button--primary")).toBe(true);
    fireEvent.click(sample);
    expect(view.getByRole("button", { name: "正在创建示例工作区…" }).getAttribute("aria-busy")).toBe("true");
    const manual = view.getByRole("button", { name: "创建空白工作区" }) as HTMLButtonElement;
    expect(manual.disabled).toBe(true);
    fireEvent.click(manual);
    expect(runtime.stageWorkspaceCreate).toHaveBeenCalledOnce();
    await act(async () => { finish({ ok: true }); });
    expect(onSampleCreated).toHaveBeenCalledOnce();
    expect(runtime.syncCurrent).toHaveBeenCalledOnce();
  });

  it.each([new Error("internal database detail"), "unknown"])("shows a readable retryable error for thrown failures", async (error) => {
    runtime.stageWorkspaceCreate.mockRejectedValueOnce(error).mockResolvedValueOnce({ ok: true });
    const onSampleCreated = vi.fn();
    const view = render(<OnboardingScreen onSampleCreated={onSampleCreated} />);
    fireEvent.click(view.getByRole("button", { name: "一键体验示例工作区" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("请重试"));
    expect(view.getByRole("alert").textContent).not.toContain("internal database detail");
    expect(onSampleCreated).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "一键体验示例工作区" }));
    await waitFor(() => expect(onSampleCreated).toHaveBeenCalledOnce());
  });

  it("keeps the sample label unchanged while creating an empty workspace", async () => {
    runtime.stageWorkspaceCreate.mockResolvedValue({ ok: false });
    const view = render(<OnboardingScreen />);
    fireEvent.submit(view.getByRole("button", { name: "创建空白工作区" }).closest("form")!);
    expect(view.getByRole("button", { name: "创建中…" })).toBeTruthy();
    expect(view.getByRole("button", { name: "一键体验示例工作区" })).toBeTruthy();
    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    expect(view.getByRole("button", { name: "创建空白工作区" }).hasAttribute("disabled")).toBe(false);
  });
});
