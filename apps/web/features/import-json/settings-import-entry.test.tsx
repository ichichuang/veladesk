// @vitest-environment jsdom
/*
 * Task 024 §65–§67 — the Settings → General → Data entry: the three
 * actions exist, the import dialog is a SEPARATE overlay that never
 * disturbs the Settings 880×680 surface identity, the AI prompt lands on
 * the clipboard verbatim, the template download fires with the canonical
 * filename, and closing the import returns focus to the Import JSON
 * button. None of this writes the workspace (SettingsCenter has no
 * persistence access at all).
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { UI_LOCALE_STORAGE_KEY } from "../i18n/locale";
import { WorkspaceRuntimeContextProvider } from "../workspace-runtime/use-workspace-runtime";
import { VdPortalContainerProvider } from "@components/ui/overlay-scope";
import { SettingsCenter } from "../home/settings-center";
import { officeWorkspace } from "./fixtures";
import { IMPORT_TEMPLATE_FILENAME } from "./template";

/** The import dialog grabs the runtime from context; nothing here writes. */
const idleRuntime: WorkspaceClientRuntime = {
  getSnapshot: () => {
    throw new Error("unexpected getSnapshot in settings test");
  },
  subscribe: () => () => {},
  initialize: () => Promise.reject(new Error("unexpected initialize")),
  selectWorkspace: () => Promise.reject(new Error("unexpected selectWorkspace")),
  stageWorkspaceCreate: () => Promise.reject(new Error("unexpected stageWorkspaceCreate")),
  stageWorkspaceUpdate: () => Promise.reject(new Error("unexpected stageWorkspaceUpdate")),
  syncCurrent: () => Promise.reject(new Error("unexpected syncCurrent")),
  pullCurrent: () => Promise.reject(new Error("unexpected pullCurrent")),
  close: () => {},
};

function renderSettings(): ReturnType<typeof render> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return render(
    <VdPortalContainerProvider value={host}>
      <WorkspaceRuntimeContextProvider value={idleRuntime}>
        <UiLocaleProvider>
          <SettingsCenter
            open={true}
            workspace={officeWorkspace().workspace}
            onPreviewAppearance={() => {}}
            onSave={async () => ({ ok: true })}
            onClose={() => {}}
            activeSectionId="page-office"
          />
        </UiLocaleProvider>
      </WorkspaceRuntimeContextProvider>
    </VdPortalContainerProvider>,
  );
}

async function openGeneral(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("Settings → General → Data (task 024 §7)", () => {
  it("shows the Data section with all three actions", async () => {
    renderSettings();
    await openGeneral();
    expect(screen.getByText("Import apps & sections")).toBeDefined();
    expect(screen.getByRole("button", { name: "Download template" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy AI prompt" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeDefined();
  });

  it("opens the import dialog as a separate overlay without touching the Settings frame", async () => {
    renderSettings();
    await openGeneral();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
    });
    expect(screen.getByRole("dialog", { name: "Import apps & sections" })).toBeDefined();
    // The Settings painted surface remains exactly ONE node.
    expect(document.querySelectorAll("[data-settings-surface]")).toHaveLength(1);
    // The import dialog is its own surface, never the settings frame.
    const importSurfaces = Array.from(document.querySelectorAll("[data-vd-surface]")).filter(
      (node) => !node.hasAttribute("data-settings-surface")
    );
    expect(importSurfaces.length).toBeGreaterThan(0);
    expect(document.querySelector("[data-settings-surface]")?.hasAttribute("data-import-dropzone")).toBe(false);
  });

  it("closing the import dialog returns focus to the Import JSON button", async () => {
    renderSettings();
    await openGeneral();
    const trigger = screen.getByRole("button", { name: "Import JSON" });
    await act(async () => {
      fireEvent.click(trigger);
    });
    const dialog = screen.getByRole("dialog", { name: "Import apps & sections" });
    expect(dialog).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Import apps & sections" })).toBeNull()
    );
    await waitFor(() => {
      expect(document.activeElement === trigger || trigger.contains(document.activeElement)).toBe(true);
    });
  });
});

describe("Settings → General → Data: copy AI prompt (task 024 §6, §67)", () => {
  it("copies the locale's prompt verbatim with no workspace write", async () => {
    const writeText = vi.fn((text: string) => {
      void text;
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderSettings();
    await openGeneral();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy AI prompt" }));
    });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const prompt = writeText.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("VelaDesk Import JSON v1");
    expect(prompt).toContain('"format": "veladesk-import"');
    expect(prompt).toContain('"version": 1');
    expect(prompt).toContain('"sections"');
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"url"');
    expect(prompt).toContain('"icon": "auto"');
    expect(prompt).toContain("internal IDs");
    expect(prompt).toContain("valid JSON only");
    expect(prompt).toContain("JSON.parse");
    expect(screen.getByText("AI prompt copied")).toBeDefined();
  });
});

describe("Settings → General → Data: download template (task 024 §44, §66)", () => {
  it("downloads veladesk-import-v1.json through a temporary object URL", async () => {
    const clicks: { download: string }[] = [];
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:settings-template");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download });
    });
    renderSettings();
    await openGeneral();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download template" }));
    });
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]?.download).toBe(IMPORT_TEMPLATE_FILENAME);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:settings-template");
  });
});
