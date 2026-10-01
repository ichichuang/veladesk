// @vitest-environment jsdom
/*
 * Task 025 §12 — the Settings → General version display is DERIVED from
 * the single version chain (root package.json → next.config injection →
 * VELADESK_VERSION), never a hand-written number. The assertion compares
 * against the imported constant, so no test hardcodes a version.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyWorkspace } from "@veladesk/domain";

import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { UI_LOCALE_STORAGE_KEY } from "../i18n/locale";
import { VdPortalContainerProvider } from "@components/ui/overlay-scope";
import { SettingsCenter } from "./settings-center";
import { VELADESK_VERSION } from "../../lib/app-version";

function renderSettings(): ReturnType<typeof render> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return render(
    <VdPortalContainerProvider value={host}>
      <UiLocaleProvider>
        <SettingsCenter
          open={true}
          workspace={createEmptyWorkspace({
            workspaceId: "ws-v",
            workspaceName: "V",
            pageId: "page-1",
            pageName: "Alpha",
            grid: { columns: 3, rows: 3 },
          })}
          onPreviewAppearance={() => {}}
          onSave={async () => ({ ok: true })}
          onClose={() => {}}
          activeSectionId="page-1"
        />
      </UiLocaleProvider>
    </VdPortalContainerProvider>,
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Settings → General version display (task 025 §12)", () => {
  it("shows exactly VELADESK_VERSION under the localized Version label", async () => {
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "General" }));
    });
    const row = screen.getByText("Version", { exact: true });
    expect(row).toBeDefined();
    const value = document.querySelector("[data-veladesk-version]");
    expect(value).not.toBeNull();
    // Derived from the shared constant — never a hardcoded literal.
    expect(value?.textContent).toBe(VELADESK_VERSION);
  });

  it("never hardcodes a version literal in settings-center.tsx", () => {
    // Source contract: the component reads VELADESK_VERSION; a hardcoded
    // number in the JSX would be a second, hand-maintained version source.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "settings-center.tsx"),
      "utf8",
    );
    expect(source).toMatch(/VELADESK_VERSION/);
    expect(source).not.toMatch(/"0\.1\.0"/);
    expect(source).not.toMatch(/>\s*0\.\d+\.\d+\s*</);
  });
});
