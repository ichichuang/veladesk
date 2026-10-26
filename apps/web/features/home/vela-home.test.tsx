// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import { gsap } from "@components/vd/gsap";
import { VelaHome } from "./vela-home";

const store = vi.hoisted(() => ({
  state: { status: "empty" } as Record<string, unknown>,
  listeners: new Set<() => void>(),
}));
vi.mock("../workspace-runtime/workspace-runtime-provider", () => ({
  WorkspaceRuntimeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../workspace-runtime/use-workspace-runtime", () => ({
  useWorkspaceRuntimeState: () => useSyncExternalStore(
    (listener) => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; },
    () => store.state,
  ),
  useWorkspaceRuntimeInstance: () => ({
    stageWorkspaceCreate: async (snapshot: WorkspaceSnapshot) => {
      store.state = { status: "ready", workspace: { id: snapshot.id, snapshot } };
      store.listeners.forEach((listener) => listener());
      return { ok: true };
    },
    syncCurrent: async () => { throw new Error("offline"); },
  }),
}));
vi.mock("./responsive-workspace-shell", () => ({
  ResponsiveWorkspaceShell: ({ workspace, onReady }: { workspace: { snapshot: WorkspaceSnapshot }; onReady?: () => void }) =>
    <main aria-label="Desktop">{workspace.snapshot.pages[0]?.name}<button onClick={onReady}>Paint desktop</button></main>,
}));
afterEach(() => { cleanup(); vi.useRealTimers(); store.state = { status: "empty" }; });

describe("first desktop entry", () => {
  it("retains success feedback after onboarding unmounts, even offline, and allows dismissal", async () => {
    const view = render(<VelaHome />);
    fireEvent.click(view.getByRole("button", { name: "一键体验示例工作区" }));
    await waitFor(() => expect(view.getByRole("main", { name: "Desktop" }).textContent).toContain("前端开发"));
    expect(view.queryByRole("status")).toBeNull();
    fireEvent.click(view.getByText("Paint desktop"));
    expect(view.getByRole("status").textContent).toContain("示例桌面已就绪");
    fireEvent.click(view.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(view.queryByRole("status")).toBeNull());
  });

  it("automatically dismisses the success notice", async () => {
    vi.useFakeTimers();
    const view = render(<VelaHome />);
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "一键体验示例工作区" })); });
    act(() => vi.advanceTimersByTime(8000));
    expect(view.queryByRole("status")).toBeNull();
    fireEvent.click(view.getByText("Paint desktop"));
    expect(view.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(6999));
    expect(view.getByRole("status").getAttribute("data-exiting")).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(view.getByRole("status").getAttribute("data-exiting")).toBe("true");
    act(() => { gsap.getTweensOf(view.getByRole("status")).forEach(tween => tween.progress(1)); });
    expect(view.queryByRole("status")).toBeNull();
  });
});
