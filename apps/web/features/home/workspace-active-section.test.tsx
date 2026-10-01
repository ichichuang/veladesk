// @vitest-environment jsdom
/*
 * Task 026 §17 — the shared active-section owner extracted from
 * DesktopShell: boot resolution from the 023-A view state, request-time
 * persistence, scroll recording, structural fallback, the flush-boundary
 * scroll capture, and the external pass-through contract that keeps
 * standalone DesktopShell renders single-owner.
 */

import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";

import { useWorkspaceActiveSection } from "./workspace-active-section";
import type { WorkspaceActiveSection } from "./workspace-active-section";
import { workspaceViewStateStorageKey } from "./workspace-view-state";

function stored(workspaceId: string): { activeSectionId: string | null } | null {
  const raw = window.localStorage.getItem(workspaceViewStateStorageKey(workspaceId));
  return raw === null ? null : (JSON.parse(raw) as { activeSectionId: string | null });
}

function hookInput(overrides: Partial<Parameters<typeof useWorkspaceActiveSection>[0]> = {}) {
  return {
    workspaceId: "ws-1",
    pageIds: ["page-a", "page-b", "page-c"] as const,
    defaultSectionId: "page-a" as string | null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useWorkspaceActiveSection (owned)", () => {
  it("boots on the persisted last-used section (023-A precedence)", () => {
    window.localStorage.setItem(
      workspaceViewStateStorageKey("ws-1"),
      JSON.stringify({ version: 1, activeSectionId: "page-c", scrollTopBySectionId: {}, updatedAt: 1 }),
    );
    const { result } = renderHook(() => useWorkspaceActiveSection(hookInput()));
    expect(result.current.activePageId).toBe("page-c");
    expect(result.current.effectiveActivePageId).toBe("page-c");
  });

  it("falls back default → first when the persisted section vanished", () => {
    window.localStorage.setItem(
      workspaceViewStateStorageKey("ws-1"),
      JSON.stringify({ version: 1, activeSectionId: "page-gone", scrollTopBySectionId: {}, updatedAt: 1 }),
    );
    const { result } = renderHook(() => useWorkspaceActiveSection(hookInput()));
    expect(result.current.effectiveActivePageId).toBe("page-a");
  });

  it("requestActiveSection updates state and persists (flush on unmount)", () => {
    const { result, unmount } = renderHook(() => useWorkspaceActiveSection(hookInput()));
    act(() => {
      result.current.requestActiveSection("page-b");
    });
    expect(result.current.activePageId).toBe("page-b");
    expect(stored("ws-1")).toBeNull(); // coalesced — nothing on disk yet
    unmount();
    expect(stored("ws-1")?.activeSectionId).toBe("page-b");
  });

  it("records scrollTop into the same persisted payload", () => {
    const { result, unmount } = renderHook(() => useWorkspaceActiveSection(hookInput()));
    act(() => {
      result.current.requestActiveSection("page-b");
      result.current.recordScrollTop("page-b", 320);
    });
    unmount();
    const raw = JSON.parse(
      window.localStorage.getItem(workspaceViewStateStorageKey("ws-1")) ?? "{}",
    ) as { activeSectionId: string | null; scrollTopBySectionId: Record<string, number> };
    expect(raw.activeSectionId).toBe("page-b");
    expect(raw.scrollTopBySectionId["page-b"]).toBe(320);
  });

  it("runs the DOM scroll capture at the unmount flush boundary, BEFORE the write", () => {
    const order: string[] = [];
    const capture = vi.fn(() => {
      order.push("capture");
      // The capture's own recordScrollTop must still reach this flush.
      result.current.recordScrollTop("page-a", 88);
    });
    const { result, unmount } = renderHook(() =>
      useWorkspaceActiveSection(hookInput({ captureActiveScroll: capture })),
    );
    unmount();
    expect(capture).toHaveBeenCalledTimes(1);
    const raw = JSON.parse(
      window.localStorage.getItem(workspaceViewStateStorageKey("ws-1")) ?? "{}",
    ) as { scrollTopBySectionId: Record<string, number> };
    expect(raw.scrollTopBySectionId["page-a"]).toBe(88);
    expect(order).toEqual(["capture"]);
  });

  it("survives StrictMode's simulated unmount without losing the destination", () => {
    function Host() {
      const active = useWorkspaceActiveSection(hookInput());
      return <button type="button" onClick={() => active.requestActiveSection("page-c")} />;
    }
    const { container } = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    act(() => {
      container.querySelector("button")?.click();
    });
    cleanup();
    expect(stored("ws-1")?.activeSectionId).toBe("page-c");
  });
});

describe("useWorkspaceActiveSection (external pass-through)", () => {
  it("returns the external instance verbatim and owns no persistence", () => {
    const external: WorkspaceActiveSection = {
      activePageId: "page-b",
      effectiveActivePageId: "page-b",
      requestActiveSection: () => {},
      recordScrollTop: () => {},
    };
    const { result, unmount } = renderHook(() =>
      useWorkspaceActiveSection(hookInput({ external })),
    );
    expect(result.current).toBe(external);
    act(() => {
      external.requestActiveSection("page-c"); // no-op double, but identity stays
    });
    expect(result.current).toBe(external);
    unmount();
    expect(window.localStorage.getItem(workspaceViewStateStorageKey("ws-1"))).toBeNull();
  });
});
