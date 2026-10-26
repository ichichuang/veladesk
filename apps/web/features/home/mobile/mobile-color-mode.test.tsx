// @vitest-environment jsdom
/*
 * Mobile live color-mode switch (reported bug: changing the OS appearance
 * while the workspace is open did nothing until the page was reloaded).
 *
 * These tests drive the REAL MobileShell with a controllable matchMedia
 * double and assert the `data-vd-color-mode` the whole palette hangs off —
 * the seam that was previously untested end to end.
 */

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { DEFAULT_WORKSPACE_APPEARANCE, createEmptyWorkspace } from "@veladesk/domain";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { runtimeManagementStub } from "../../workspace-runtime/test-runtime-management";
import { WorkspaceRuntimeContextProvider } from "../../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../../i18n/ui-locale-provider";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { MobileShell } from "./mobile-shell";

type ChangeListener = (event: { matches: boolean }) => void;

/**
 * A matchMedia double whose every query can be flipped after mount — the
 * user toggling the OS appearance in Settings / the control center.
 */
function installMatchMedia(prefersLight: () => boolean) {
  const listeners = new Set<ChangeListener>();
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      get matches() {
        return query === "(prefers-color-scheme: light)" ? prefersLight() : false;
      },
      media: query,
      onchange: null,
      addEventListener(_type: string, listener: ChangeListener) {
        listeners.add(listener);
      },
      removeEventListener(_type: string, listener: ChangeListener) {
        listeners.delete(listener);
      },
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  );
  return {
    flip() {
      for (const listener of [...listeners]) {
        listener({ matches: prefersLight() });
      }
    },
  };
}

const rejectRuntime: WorkspaceClientRuntime = {
  ...runtimeManagementStub,
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

function workspaceWithColorMode(colorMode: "system" | "light" | "dark"): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-theme",
    workspaceName: "Desk",
    pageId: "page-work",
    pageName: "办公",
    grid: { columns: 4, rows: 4 },
  });
  return {
    ...base,
    preferences: {
      ...base.preferences,
      appearance: { ...DEFAULT_WORKSPACE_APPEARANCE, colorMode },
    },
  };
}

function record(snapshot: WorkspaceSnapshot): LocalWorkspaceRecord {
  return {
    id: snapshot.id,
    snapshot,
    serverRevision: null,
    localGeneration: 0,
    syncState: "clean",
    updatedAt: 0,
    lastSyncedAt: null,
  };
}

function Host({ snapshot }: { readonly snapshot: WorkspaceSnapshot }) {
  const [pageId] = useState<string | null>("page-work");
  const activeSection: WorkspaceActiveSection = {
    activePageId: pageId,
    effectiveActivePageId: pageId ?? snapshot.pages[0]!.id,
    requestActiveSection: () => {},
    recordScrollTop: () => {},
  };
  return (
    <WorkspaceRuntimeContextProvider value={rejectRuntime}>
      <UiLocaleProvider>
        <MobileShell workspace={record(snapshot)} activeSection={activeSection} />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>
  );
}

function shellColorMode(container: HTMLElement): string | undefined {
  return container.ownerDocument
    .querySelector<HTMLElement>(".vela-mobile-shell")
    ?.dataset.vdColorMode;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("mobile shell follows the OS color mode live", () => {
  it("system: opens dark, switches to light and back without a reload", () => {
    let light = false;
    const media = installMatchMedia(() => light);
    const { container } = render(<Host snapshot={workspaceWithColorMode("system")} />);

    expect(shellColorMode(container)).toBe("dark");

    light = true;
    act(() => {
      media.flip();
    });
    expect(shellColorMode(container)).toBe("light");
    // The document itself follows too (browser-owned overscroll canvas).
    expect(document.documentElement.style.colorScheme).toBe("light");

    light = false;
    act(() => {
      media.flip();
    });
    expect(shellColorMode(container)).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("system: picks up a switch made while the page was in the background", () => {
    let light = false;
    installMatchMedia(() => light);
    const { container } = render(<Host snapshot={workspaceWithColorMode("system")} />);
    expect(shellColorMode(container)).toBe("dark");

    // No `change` event reached the suspended page; it is shown again.
    light = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(shellColorMode(container)).toBe("light");
  });

  it("system: starts light when the OS already prefers light (no wrong frame)", () => {
    installMatchMedia(() => true);
    const { container } = render(<Host snapshot={workspaceWithColorMode("system")} />);

    expect(shellColorMode(container)).toBe("light");
  });

  it("manual dark ignores the OS switching to light", () => {
    let light = false;
    const media = installMatchMedia(() => light);
    const { container } = render(<Host snapshot={workspaceWithColorMode("dark")} />);

    expect(shellColorMode(container)).toBe("dark");

    light = true;
    act(() => {
      media.flip();
    });
    expect(shellColorMode(container)).toBe("dark");
  });

  it("manual light ignores the OS switching to dark", () => {
    let light = true;
    const media = installMatchMedia(() => light);
    const { container } = render(<Host snapshot={workspaceWithColorMode("light")} />);

    expect(shellColorMode(container)).toBe("light");

    light = false;
    act(() => {
      media.flip();
    });
    expect(shellColorMode(container)).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("restores the document color-scheme when the shell unmounts", () => {
    installMatchMedia(() => true);
    const { unmount } = render(<Host snapshot={workspaceWithColorMode("light")} />);
    expect(document.documentElement.style.colorScheme).toBe("light");
    unmount();
    expect(document.documentElement.style.colorScheme).toBe("");
  });
});
