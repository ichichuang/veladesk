// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { AppShortcut } from "@veladesk/domain";

import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { AppAppearanceInspector } from "./app-appearance-inspector";
import { openAppearanceSession } from "./app-appearance-session";
import { handleAppearanceAppClick } from "./appearance-app-click";

vi.mock("../workspace-runtime/use-workspace-runtime", () => ({
  useWorkspaceRuntimeInstance: () => ({}),
}));

afterEach(cleanup);

const apps: AppShortcut[] = ["Alpha", "Beta"].map((name) => ({
  kind: "app", id: name, name, url: `https://${name.toLowerCase()}.example`,
  icon: { kind: "generated", text: name[0]!, source: "auto" },
  openMode: "new-tab", tags: [],
}));
const workspace = {
  ...createEmptyWorkspace({ workspaceId: "ws", workspaceName: "Desk", pageId: "page", pageName: "Home", grid: { columns: 3, rows: 3 } }),
  entities: apps,
};

function Harness({ initiallyOpen = true, launch = vi.fn() }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [session, setSession] = useState(() => openAppearanceSession(apps[0]!));
  return <UiLocaleProvider>
    <div onClickCapture={(event) => handleAppearanceAppClick(event, open, session.appId, apps,
      (app) => setSession(openAppearanceSession(app)))}>
      <button>Empty desktop</button>
      {apps.map((app) => <button key={app.id} data-appearance-app-id={app.id} onClick={launch}>
        <span>{app.name} tile</span>
      </button>)}
      <AppAppearanceInspector open={open} workspace={workspace}
        appId={session.appId} draft={session.draft}
        onDraftChange={(draft) => setSession({ ...session, draft })}
        onCancel={() => setOpen(false)} onSaved={() => setOpen(false)} />
    </div>
  </UiLocaleProvider>;
}

describe("appearance drawer interaction", () => {
  it("stays open after outside pointer and focus, switches apps without launching, and closes with Escape", async () => {
    const launch = vi.fn();
    const view = render(<Harness launch={launch} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const outside = view.getByRole("button", { name: "Empty desktop" });
    expect(document.body.style.pointerEvents).not.toBe("none");
    fireEvent.pointerDown(outside);
    act(() => outside.focus());
    fireEvent.click(outside);
    expect(view.getByRole("dialog")).toBeTruthy();
    const panel = view.getByRole("dialog");
    expect(view.getByText("按 Esc 或点 × 关闭")).toBeTruthy();
    fireEvent.click(view.getByText("Beta tile"));
    expect(view.getByRole("dialog")).toBe(panel);
    expect(launch).not.toHaveBeenCalled();
    expect(view.getByRole("dialog").textContent).toContain("Beta");
    fireEvent.click(view.getByText("Beta tile"));
    expect(launch).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  });

  it("resets the nested icon picker when switching apps without replacing the panel", async () => {
    const view = render(<Harness />);
    const panel = view.getByRole("dialog");
    fireEvent.click(view.getByRole("button", { name: "更换图标" }));
    expect(view.getAllByRole("dialog", { hidden: true })).toHaveLength(2);
    fireEvent.click(view.getByText("Beta tile"));
    await waitFor(() => expect(view.getAllByRole("dialog")).toHaveLength(1));
    expect(view.getByRole("dialog")).toBe(panel);
    expect(panel.textContent).toContain("Beta");
  });

  it("closes with its own close button", async () => {
    const view = render(<Harness />);
    fireEvent.click(view.getByRole("button", { name: /关闭|Close/ }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  });

  it("preserves normal app activation when the drawer is closed", () => {
    const launch = vi.fn();
    const view = render(<Harness initiallyOpen={false} launch={launch} />);
    fireEvent.click(view.getByText("Beta tile"));
    expect(launch).toHaveBeenCalledOnce();
  });
});
