// @vitest-environment jsdom
/*
 * Task 024 — the import dialog's wiring-level contracts (task §63–§71):
 * parse/preview/cancel perform ZERO workspace writes; one confirmed
 * import performs exactly ONE stage + one sync; a materially changed
 * workspace forces a re-confirmation instead of writing; errors disable
 * the Import button; file handling rejects oversized input before reading.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { UI_LOCALE_STORAGE_KEY } from "../i18n/locale";
import { WorkspaceRuntimeContextProvider } from "../workspace-runtime/use-workspace-runtime";
import { VdPortalContainerProvider } from "@components/ui/overlay-scope";

import { IMPORT_MAX_JSON_BYTES } from "./contract";
import { ImportJsonDialog } from "./import-json-dialog";
import { addApp, addSection, officeWorkspace } from "./fixtures";

function makeRuntime(spies?: {
  stageWorkspaceUpdate: (snapshot: WorkspaceSnapshot) => Promise<unknown>;
  syncCurrent: () => Promise<unknown>;
}): WorkspaceClientRuntime {
  const reject = (name: string) =>
    Promise.reject(new Error(`unexpected runtime call in test: ${name}`)) as never;
  return {
    getSnapshot: reject.bind(null, "getSnapshot") as never,
    subscribe: () => () => {},
    initialize: () => reject("initialize"),
    selectWorkspace: () => reject("selectWorkspace"),
    stageWorkspaceCreate: () => reject("stageWorkspaceCreate"),
    stageWorkspaceUpdate: spies ? (spies.stageWorkspaceUpdate as never) : () => reject("stageWorkspaceUpdate"),
    syncCurrent: spies ? (spies.syncCurrent as never) : () => reject("syncCurrent"),
    pullCurrent: () => reject("pullCurrent"),
    close: () => {},
  };
}

function renderDialog(
  workspace: WorkspaceSnapshot,
  runtime: WorkspaceClientRuntime,
  onClose: () => void = () => {}
): { view: RenderResult; rerender: (workspace: WorkspaceSnapshot) => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const tree = (ws: WorkspaceSnapshot) => (
    <VdPortalContainerProvider value={host}>
      <WorkspaceRuntimeContextProvider value={runtime}>
        <UiLocaleProvider>
          <ImportJsonDialog workspace={ws} onClose={onClose} />
        </UiLocaleProvider>
      </WorkspaceRuntimeContextProvider>
    </VdPortalContainerProvider>
  );
  const view = render(tree(workspace));
  return { view, rerender: (ws: WorkspaceSnapshot) => view.rerender(tree(ws)) };
}

async function pasteAndParse(view: RenderResult, text: string): Promise<void> {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Paste JSON" }));
  });
  await act(async () => {
    fireEvent.change(view.getByLabelText("Paste JSON"), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Parse and preview" }));
  });
}

/** jsdom Blob/File lack .text() — give the instance a real one. */
function jsonFile(text: string, overrides: { size?: number } = {}): File {
  const file = new File([text], "import.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  if (overrides.size !== undefined) {
    Object.defineProperty(file, "size", { value: overrides.size });
  }
  return file;
}

function chooseFile(file: File): void {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("file input not rendered");
  }
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);
}

function templateText(): string {
  return JSON.stringify(
    {
      format: "veladesk-import",
      version: 1,
      sections: [
        { name: "办公", apps: [{ name: "GitHub", url: "https://github.com/", icon: "auto" }] },
        { name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.com/", icon: "auto" }] },
      ],
    },
    null,
    2
  );
}

const twentyAppsText = (): string =>
  JSON.stringify({
    format: "veladesk-import",
    version: 1,
    sections: [
      { name: "A", apps: Array.from({ length: 7 }, (_u, i) => ({ name: `A${i}`, url: `https://a${i}.test/` })) },
      { name: "B", apps: Array.from({ length: 7 }, (_u, i) => ({ name: `B${i}`, url: `https://b${i}.test/` })) },
      { name: "C", apps: Array.from({ length: 6 }, (_u, i) => ({ name: `C${i}`, url: `https://c${i}.test/` })) },
    ],
  });

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ImportJsonDialog: input modes", () => {
  it("renders the input surface with both modes and no writes", () => {
    const spies = {
      stageWorkspaceUpdate: vi.fn(() => Promise.resolve({ ok: true })),
      syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })),
    };
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime(spies));
    expect(view.getByRole("button", { name: "Upload JSON" })).toBeDefined();
    expect(view.getByRole("button", { name: "Paste JSON" })).toBeDefined();
    expect(spies.stageWorkspaceUpdate).not.toHaveBeenCalled();
    expect(spies.syncCurrent).not.toHaveBeenCalled();
  });

  it("parses a pasted document into the preview without writing", async () => {
    const spies = {
      stageWorkspaceUpdate: vi.fn(() => Promise.resolve({ ok: true })),
      syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })),
    };
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime(spies));
    await pasteAndParse(view, templateText());
    expect(view.getByText("Ready to import")).toBeDefined();
    expect(view.getByText("2 sections · 2 apps")).toBeDefined();
    expect(spies.stageWorkspaceUpdate).not.toHaveBeenCalled();
    expect(spies.syncCurrent).not.toHaveBeenCalled();
  });

  it("shows a syntax error for malformed JSON and recovers on reparse", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    await pasteAndParse(view, "{ not json");
    const errors = view.getByRole("alert");
    expect(errors.textContent).toContain("Invalid JSON");
    // Fix the textarea and reparse — no stale errors remain.
    await act(async () => {
      fireEvent.change(view.getByLabelText("Paste JSON"), { target: { value: templateText() } });
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Parse and preview" }));
    });
    expect(view.getByText("Ready to import")).toBeDefined();
    expect(view.queryAllByRole("alert")).toEqual([]);
  });

  it("parses a valid uploaded JSON file into the preview", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    await act(async () => {
      chooseFile(jsonFile(templateText()));
    });
    await waitFor(() => expect(view.getByText("Ready to import")).toBeDefined());
  });

  it("rejects an oversized file before reading it", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    const textSpy = vi.fn(() => Promise.resolve("unused"));
    const file = new File([""], "huge.json");
    Object.defineProperty(file, "size", { value: IMPORT_MAX_JSON_BYTES + 1 });
    Object.defineProperty(file, "text", { value: textSpy });
    await act(async () => {
      chooseFile(file);
    });
    await waitFor(() =>
      expect(view.getByText("File too large (limit 1 MiB)")).toBeDefined()
    );
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("rejects dropping more than one file", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    const dropzone = document.querySelector("[data-import-dropzone]");
    if (!(dropzone instanceof HTMLElement)) {
      throw new Error("dropzone not rendered");
    }
    await act(async () => {
      fireEvent.drop(dropzone, { dataTransfer: { files: [jsonFile("a"), jsonFile("b")] } });
    });
    await waitFor(() =>
      expect(view.getByText("Drop exactly one JSON file.")).toBeDefined()
    );
  });
});

describe("ImportJsonDialog: preview accuracy", () => {
  it("shows the exact summary and enables Import for a valid plan", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    await pasteAndParse(
      view,
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [
          {
            name: "Office",
            apps: ["GitHub", "Notion", "Figma", "Linear", "Vercel", "Raycast", "Arc", "Slack"].map(
              (name, index) => ({ name, url: index === 0 ? "https://github.com/" : `https://${name.toLowerCase()}.test/` })
            ),
          },
          {
            name: "Alpha",
            apps: ["ChatGPT", "Claude", "Perplexity", "Gemini"].map((name) => ({
              name,
              url: `https://${name.toLowerCase()}.test/`,
            })),
          },
          {
            name: "Beta",
            apps: [
              { name: "Obsidian", url: "https://obsidian.test/" },
              { name: "ChatGPT dup", url: "https://chatgpt.test/" },
              { name: "GitHub dup", url: "https://github.com/" },
            ],
          },
        ],
      })
    );
    expect(view.getByText("Ready to import")).toBeDefined();
    expect(view.getByText("3 sections · 15 apps")).toBeDefined();
    expect(view.getByText("Will create: 2 sections · 12 apps")).toBeDefined();
    expect(view.getByText("Will merge: 1 sections")).toBeDefined();
    expect(view.getByText("Will skip: 3 duplicate apps")).toBeDefined();
    const importButton = view.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);
  });

  it("disables Import and shows located errors for a blocked plan", async () => {
    const ambiguous = addSection(officeWorkspace().workspace, "page-office-2", " office ");
    const { view } = renderDialog(ambiguous, makeRuntime());
    await pasteAndParse(
      view,
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "Office", apps: [{ name: "Notion", url: "https://notion.test/" }] }],
      })
    );
    const importButton = view.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    const alerts = view.getAllByRole("alert");
    expect(alerts.some((node) => node.textContent?.includes("merge target is ambiguous"))).toBe(true);
  });
});

describe("ImportJsonDialog: writes", () => {
  it("performs exactly one stage + one sync for a confirmed import of 3 sections / 20 apps", async () => {
    const stageWorkspaceUpdate = vi.fn((snapshot: WorkspaceSnapshot) => {
      void snapshot;
      return Promise.resolve({ ok: true });
    });
    const syncCurrent = vi.fn(() => Promise.resolve({ status: "synced" }));
    const spies = { stageWorkspaceUpdate, syncCurrent };
    const { workspace } = officeWorkspace();
    const { view } = renderDialog(workspace, makeRuntime(spies));
    await pasteAndParse(view, twentyAppsText());
    expect(stageWorkspaceUpdate).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    expect(stageWorkspaceUpdate).toHaveBeenCalledTimes(1);
    expect(syncCurrent).toHaveBeenCalledTimes(1);
    const staged = stageWorkspaceUpdate.mock.calls[0]?.[0] as WorkspaceSnapshot;
    expect(staged.pages.map((page) => page.name)).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(staged.entities.filter((entity) => entity.kind === "app")).toHaveLength(1 + 20);
    expect(view.getByText("3 new sections")).toBeDefined();
    expect(view.getByText("20 new apps")).toBeDefined();
    expect(view.getByText("0 duplicate apps skipped")).toBeDefined();
  });

  it("cancel (Back, then Cancel) writes nothing and closes", async () => {
    const onClose = vi.fn();
    const stageWorkspaceUpdate = vi.fn(() => Promise.resolve({ ok: true }));
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn() }),
      onClose
    );
    await pasteAndParse(view, templateText());
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Back to edit" }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    });
    expect(stageWorkspaceUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Done on the success surface closes exactly once", async () => {
    const onClose = vi.fn();
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({
        stageWorkspaceUpdate: vi.fn(() => Promise.resolve({ ok: true })),
        syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })),
      }),
      onClose
    );
    await pasteAndParse(view, templateText());
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Done" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the preview open with an error when staging fails", async () => {
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({
        stageWorkspaceUpdate: vi.fn(() => Promise.resolve({ ok: false, reason: "invalid-workspace" })),
        syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })),
      })
    );
    await pasteAndParse(view, templateText());
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() =>
      expect(view.getByText("Saving the import failed; please try again.")).toBeDefined()
    );
    expect(view.getByText("Ready to import")).toBeDefined();
  });
});

describe("ImportJsonDialog: concurrent workspace change (task §36, §64)", () => {
  it("refuses the first confirm, updates the preview and writes on the second", async () => {
    const stageWorkspaceUpdate = vi.fn(() => Promise.resolve({ ok: true }));
    const syncCurrent = vi.fn(() => Promise.resolve({ status: "synced" }));
    const { workspace } = officeWorkspace();
    const { view, rerender } = renderDialog(workspace, makeRuntime({ stageWorkspaceUpdate, syncCurrent }));

    const text = JSON.stringify({
      format: "veladesk-import",
      version: 1,
      sections: [{ name: "AI", apps: [{ name: "ChatGPT", url: "https://chatgpt.test/" }] }],
    });
    await pasteAndParse(view, text);
    expect(view.getByText("Will create: 1 sections · 1 apps")).toBeDefined();

    // The workspace moves on after the preview (revision R2).
    const changed = addApp(workspace, "page-office", "app-chatgpt", "ChatGPT", "https://chatgpt.test/");
    rerender(changed);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    // First confirm: NO write, banner visible, preview now shows the duplicate.
    expect(stageWorkspaceUpdate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(view.getByText("The workspace changed. Please review the import again.")).toBeDefined()
    );
    expect(view.getByText("Will create: 1 sections · 0 apps")).toBeDefined();
    expect(view.getByText("Will skip: 1 duplicate apps")).toBeDefined();

    // Second confirm against the refreshed plan: exactly one write.
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    expect(stageWorkspaceUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("ImportJsonDialog: no-op import", () => {
  it("disables Import and explains when everything already exists", async () => {
    const stageWorkspaceUpdate = vi.fn(() => Promise.resolve({ ok: true }));
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn() })
    );
    await pasteAndParse(
      view,
      JSON.stringify({
        format: "veladesk-import",
        version: 1,
        sections: [{ name: "Office", apps: [{ name: "GitHub", url: "https://github.com/" }] }],
      })
    );
    const importButton = view.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    expect(view.getByText("Nothing to import.")).toBeDefined();
    expect(stageWorkspaceUpdate).not.toHaveBeenCalled();
  });
});
