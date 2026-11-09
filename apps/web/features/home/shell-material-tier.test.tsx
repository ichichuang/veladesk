// @vitest-environment jsdom
/*
 * The material-tier emission contract (P1): the desktop shell and the
 * shared overlay portal root both carry `data-vd-material`, resolved from
 * the EFFECTIVE appearance (Settings preview ?? persisted) — the persisted
 * interfaceStyle, or the nearest inferred preset for pre-019-D snapshots.
 * The token layer's tier blocks key on that attribute; components never
 * branch on it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createEmptyWorkspace, replaceWorkspacePreferences } from "@veladesk/domain";
import type { WorkspaceSnapshot, WorkspaceInterfaceStyle } from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { WorkspaceRuntimeContextProvider } from "../workspace-runtime/use-workspace-runtime";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { DesktopShell } from "./shell/desktop-shell";

function baseWorkspace(): WorkspaceSnapshot {
  return createEmptyWorkspace({
    workspaceId: "ws-m",
    workspaceName: "Material",
    pageId: "page-1",
    pageName: "One",
    grid: { columns: 4, rows: 3 },
  });
}

function recordWithInterfaceStyle(
  style: WorkspaceInterfaceStyle | undefined,
): LocalWorkspaceRecord {
  const base = baseWorkspace();
  if (style === undefined) {
    // A legacy snapshot: keep the resolved defaults, no persisted style.
    return {
      id: base.id,
      snapshot: base,
      serverRevision: null,
      localGeneration: 0,
      syncState: "clean",
      updatedAt: 0,
      lastSyncedAt: null,
    };
  }
  const replaced = replaceWorkspacePreferences(base, {
    ...base.preferences,
    appearance: { ...base.preferences.appearance!, interfaceStyle: style },
  });
  if (!replaced.ok) {
    throw new Error("test preferences refused");
  }
  return {
    id: replaced.workspace.id,
    snapshot: replaced.workspace,
    serverRevision: null,
    localGeneration: 0,
    syncState: "clean",
    updatedAt: 0,
    lastSyncedAt: null,
  };
}

const runtime: WorkspaceClientRuntime = {
  stageWorkspaceUpdate: async () => ({ ok: true }) as never,
  syncCurrent: async () => ({ status: "synced" }) as never,
  pullCurrent: async () => ({ status: "pulled" }) as never,
  stageWorkspaceCreate: async () => ({ ok: true }) as never,
  selectWorkspace: async () => ({ status: "ready" }) as never,
  initialize: async () => ({ status: "ready" }) as never,
  getSnapshot: () => {
    throw new Error("unexpected getSnapshot");
  },
  subscribe: () => () => {},
  close: () => {},
} as unknown as WorkspaceClientRuntime;

function renderShell(record: LocalWorkspaceRecord): void {
  render(
    <WorkspaceRuntimeContextProvider value={runtime}>
      <UiLocaleProvider>
        <DesktopShell workspace={record} />
      </UiLocaleProvider>
    </WorkspaceRuntimeContextProvider>,
  );
}

function themedRoots(): readonly HTMLElement[] {
  const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-vd-ui]"));
  expect(roots.length).toBeGreaterThanOrEqual(2);
  return roots;
}

beforeAll(() => {
  // Reduced motion ON keeps every scene path deterministic; matchMedia is
  // absent in jsdom, which the shared bridge treats as "no preference" —
  // so install an explicit double instead.
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
});

describe("the shell's material-tier emission (P1)", () => {
  it("carries the persisted interfaceStyle on BOTH themed roots", () => {
    renderShell(recordWithInterfaceStyle("soft"));
    for (const root of themedRoots()) {
      expect(root.getAttribute("data-vd-material")).toBe("soft");
    }
  });

  it("follows a different persisted tier verbatim", () => {
    renderShell(recordWithInterfaceStyle("clean"));
    for (const root of themedRoots()) {
      expect(root.getAttribute("data-vd-material")).toBe("clean");
    }
  });

  it("infers the nearest preset for a legacy snapshot without a persisted style", () => {
    // No persisted interfaceStyle and no appearance at all: the resolved
    // defaults (0.55/18/14) infer the glass tier.
    renderShell(recordWithInterfaceStyle(undefined));
    for (const root of themedRoots()) {
      expect(root.getAttribute("data-vd-material")).toBe("glass");
    }
  });
});
