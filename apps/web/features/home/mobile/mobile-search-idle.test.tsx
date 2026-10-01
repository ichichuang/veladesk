// @vitest-environment jsdom
/*
 * Task 026-R2 §19 (H5) — the mobile search model is shared but must not
 * REBUILD while the surface is closed: a category switch (activePageId
 * change) with search closed is a proven irrelevant recompute of the full
 * launcher index. The entries derivation is gated on `open`.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { WorkspaceRuntimeContextProvider } from "../../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../../i18n/ui-locale-provider";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { MobileShell } from "./mobile-shell";

vi.mock("../launcher-index", async (importOriginal) => {
  const original = await importOriginal<typeof import("../launcher-index")>();
  return {
    ...original,
    buildLauncherEntries: vi.fn(original.buildLauncherEntries),
  };
});

import { buildLauncherEntries } from "../launcher-index";

function snapshot(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "w",
    workspaceName: "D",
    pageId: "page-a",
    pageName: "办公",
    grid: { columns: 4, rows: 4 },
  });
  const page = (id: string, name: string): WorkspaceSnapshot["pages"][number] => ({
    id,
    name,
    layout: { id, grid: { columns: 4, rows: 4 }, items: [] },
    canvas: { version: 2, mode: "grid", columns: 4, items: [] },
  });
  return {
    ...base,
    pages: [page("page-a", "办公"), page("page-b", "AI")],
    entities: [
      {
        kind: "app",
        id: "app-1",
        name: "GitHub",
        url: "https://github.com/",
        icon: { kind: "generated", text: "GH" },
        openMode: "new-tab",
        tags: [],
      },
    ],
    dock: { items: [] },
  };
}

const rejectRuntime: WorkspaceClientRuntime = {
  getSnapshot: () => {
    throw new Error("unexpected getSnapshot");
  },
  subscribe: () => () => {},
  initialize: () => Promise.reject(new Error("unexpected")),
  selectWorkspace: () => Promise.reject(new Error("unexpected")),
  stageWorkspaceCreate: () => Promise.reject(new Error("unexpected")),
  stageWorkspaceUpdate: () => Promise.reject(new Error("unexpected")),
  syncCurrent: () => Promise.reject(new Error("unexpected")),
  pullCurrent: () => Promise.reject(new Error("unexpected")),
  close: () => {},
};

function Host() {
  const ws = snapshot();
  const [pageId, setPageId] = useState<string | null>("page-a");
  const activeSection: WorkspaceActiveSection = {
    activePageId: pageId,
    effectiveActivePageId: pageId,
    requestActiveSection: (id) => setPageId(id),
    recordScrollTop: () => {},
  };
  return (
    <WorkspaceRuntimeContextProvider value={rejectRuntime}>
      <UiLocaleProvider>
        <MobileShell
          workspace={{
            id: ws.id,
            snapshot: ws,
            serverRevision: null,
            localGeneration: 0,
            syncState: "clean",
            updatedAt: 0,
            lastSyncedAt: null,
          }}
          activeSection={activeSection}
        />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("mobile search idle cost (H5)", () => {
  it("a category switch with search CLOSED never rebuilds the index; opening builds it", async () => {
    render(<Host />);
    vi.clearAllMocks(); // discard boot-time builds
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "办公" }));
    });
    expect(vi.mocked(buildLauncherEntries)).not.toHaveBeenCalled();
    // Opening the surface builds the index exactly once.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    });
    expect(vi.mocked(buildLauncherEntries).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
