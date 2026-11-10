// @vitest-environment jsdom
import { runtimeManagementStub } from "../workspace-runtime/test-runtime-management";
/*
 * Task 024 — the import dialog's wiring-level contracts (task §63–§71):
 * parse/preview/cancel perform ZERO workspace writes; one confirmed
 * import performs exactly ONE stage + one sync; a materially changed
 * workspace forces a re-confirmation instead of writing; errors disable
 * the Import button; file handling rejects oversized input before reading.
 *
 * Recipe D1 adds the binary wiring: embedded wallpapers decode before the
 * preview (an invalid one blocks at input), the preview lists embedded /
 * needs-download wallpapers, and the confirm path stages embedded bytes
 * asset-before-workspace, fetches the missing ones and falls unresolvable
 * refs back to the preset with a done-phase note.
 */

import { webcrypto } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";

import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { UI_LOCALE_STORAGE_KEY } from "../i18n/locale";
import { WorkspaceRuntimeContextProvider } from "../workspace-runtime/use-workspace-runtime";
import { VdPortalContainerProvider } from "@components/ui/overlay-scope";

import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_JSON_TEXT_LENGTH } from "./contract";
import { ImportJsonDialog } from "./import-json-dialog";
import { addApp, addSection, officeWorkspace } from "./fixtures";

/** The browser asset runtime, mocked at the module the dialog's gateway imports. */
const assetsGateway = vi.hoisted(() => ({
  stageAsset: vi.fn(),
  getLocalAsset: vi.fn(),
  loadAsset: vi.fn(),
}));
vi.mock("../assets/browser-assets", () => ({ getBrowserAssetRuntime: async () => assetsGateway }));

function makeRuntime(spies?: {
  stageWorkspaceUpdate: (snapshot: WorkspaceSnapshot) => Promise<unknown>;
  syncCurrent: () => Promise<unknown>;
}): WorkspaceClientRuntime {
  const reject = (name: string) =>
    Promise.reject(new Error(`unexpected runtime call in test: ${name}`)) as never;
  return {
    ...runtimeManagementStub,
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
  // Recipe documents verify their embedded binaries (async) before the
  // preview renders — wait for EITHER outcome, like a user would see it.
  await waitFor(() => {
    if (view.queryByText("Ready to import") === null && view.queryAllByRole("alert").length === 0) {
      throw new Error("parse outcome not rendered yet");
    }
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
});

beforeEach(() => {
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
  // jsdom's crypto lacks subtle (no hashing); the node Web Crypto fills in.
  // Re-stubbed every test — afterEach unstubAllGlobals restores jsdom's.
  if (typeof globalThis.crypto?.subtle !== "object") {
    vi.stubGlobal("crypto", webcrypto);
  }
  // Nothing local, every fetch misses — individual tests override per case.
  assetsGateway.getLocalAsset.mockReset().mockResolvedValue(undefined);
  assetsGateway.loadAsset.mockReset().mockResolvedValue({ ok: false, reason: "not-found" });
  assetsGateway.stageAsset.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    Object.defineProperty(file, "size", { value: IMPORT_MAX_FILE_BYTES + 1 });
    Object.defineProperty(file, "text", { value: textSpy });
    await act(async () => {
      chooseFile(file);
    });
    await waitFor(() =>
      expect(view.getByText("File too large (limit 24 MiB)")).toBeDefined()
    );
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("rejects pasted text above the 1 MiB paste ceiling", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    // Non-blank content (a pure-whitespace paste is blocked by the disabled
    // Parse button) that still exceeds the 1 MiB character ceiling.
    await pasteAndParse(view, `x${" ".repeat(IMPORT_MAX_JSON_TEXT_LENGTH)}`);
    await waitFor(() =>
      expect(view.getByText("Content exceeds the 1 MiB limit.")).toBeDefined()
    );
    expect(view.queryByText("Ready to import")).toBeNull();
  });

  it("parses an uploaded file above the paste ceiling (24 MiB file budget)", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    // Whitespace is legal JSON padding: the text exceeds the 1 MiB paste
    // ceiling while the file stays inside the 24 MiB file ceiling.
    const padded = " ".repeat(IMPORT_MAX_JSON_TEXT_LENGTH + 1) + templateText();
    await act(async () => {
      chooseFile(jsonFile(padded));
    });
    await waitFor(() => expect(view.getByText("Ready to import")).toBeDefined());
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

describe("ImportJsonDialog: recipe preview & options", () => {
  const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;

  /** A deck whose "AI" space is created and whose "Office" space merges. */
  function deckText(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      format: "vela.recipe",
      version: 1,
      theme: { mode: "dark", accent: 200, material: "glass" },
      motion: { reducedMotion: "on" },
      spaces: [
        {
          name: "AI",
          layout: "grid",
          layoutMode: "snap",
          grid: { columns: 8, rows: 5 },
          wallpaper: { light: "preset:aurora", dark: `asset:${NIGHT_ID}` },
          tiles: [
            { name: "ChatGPT", url: "https://chatgpt.test/", placement: "snap", x: 0, y: 0, w: 2, h: 2 },
            { name: "Claude", url: "https://claude.test/" },
          ],
        },
        {
          name: "Office",
          layout: "canvas",
          layoutMode: "free",
          tiles: [{ name: "Notion", url: "https://www.notion.so/" }],
        },
      ],
      plugins: [],
      ...overrides,
    });
  }

  it("previews spaces, structure, wallpapers and the merge append-only note", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    await pasteAndParse(view, deckText());
    expect(view.getByText("2 spaces · 3 tiles")).toBeDefined();
    expect(view.getByText("Will create: 1 spaces · 3 tiles")).toBeDefined();
    expect(view.getByText("Will merge: 1 spaces")).toBeDefined();
    expect(
      view.getByText("Snap · 8×5 grid · 2 tiles · Light wallpaper: Aurora · Dark wallpaper: custom image (download needed)")
    ).toBeDefined();
    expect(view.getByText("Merge into existing space · 1 new apps")).toBeDefined();
    expect(
      view.getByText("apps appended only; layout and wallpapers stay unchanged")
    ).toBeDefined();
    expect(view.getByText("The deck carries theme and motion settings.")).toBeDefined();
    // Theme & motion are opt-in: the checkbox exists and starts unchecked.
    const checkbox = view.getByRole("checkbox") as HTMLButtonElement;
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
  });

  it("imports the structure but leaves preferences alone while the checkbox is unchecked", async () => {
    const stageWorkspaceUpdate = vi.fn((snapshot: WorkspaceSnapshot) => {
      void snapshot;
      return Promise.resolve({ ok: true });
    });
    const { workspace } = officeWorkspace();
    const { view } = renderDialog(
      workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })) })
    );
    await pasteAndParse(view, deckText());
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    const staged = stageWorkspaceUpdate.mock.calls[0]?.[0] as WorkspaceSnapshot;
    expect(staged.preferences).toEqual(workspace.preferences);
    expect(staged.pages.map((page) => page.name)).toEqual(expect.arrayContaining(["AI", "Office"]));
  });

  it("applies theme + motion only when the checkbox is checked", async () => {
    const stageWorkspaceUpdate = vi.fn((snapshot: WorkspaceSnapshot) => {
      void snapshot;
      return Promise.resolve({ ok: true });
    });
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })) })
    );
    await pasteAndParse(view, deckText());
    await act(async () => {
      fireEvent.click(view.getByRole("checkbox"));
    });
    expect(view.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    const staged = stageWorkspaceUpdate.mock.calls[0]?.[0] as WorkspaceSnapshot;
    expect(staged.preferences.appearance?.colorMode).toBe("dark");
    expect(staged.preferences.motion).toEqual({ reducedMotion: "on" });
  });

  it("hides the checkbox when the deck carries neither theme nor motion", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    await pasteAndParse(
      view,
      deckText({ theme: undefined, motion: undefined })
    );
    expect(view.queryByRole("checkbox")).toBeNull();
    expect(view.queryByText("The deck carries theme and motion settings.")).toBeNull();
  });

  it("drops an illegal theme FIELD with a warning; the legal rest still applies", async () => {
    const stageWorkspaceUpdate = vi.fn((snapshot: WorkspaceSnapshot) => {
      void snapshot;
      return Promise.resolve({ ok: true });
    });
    const { workspace } = officeWorkspace();
    const { view } = renderDialog(
      workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })) })
    );
    await pasteAndParse(
      view,
      deckText({ theme: { mode: "dark", accent: 999, material: "glass" }, motion: undefined })
    );
    // Legal mode/material survive → the offer stays; only the accent dropped.
    expect(view.getByRole("checkbox")).toBeDefined();
    await act(async () => {
      fireEvent.click(view.getByText("2 notices"));
    });
    expect(view.getByText(/Invalid theme field ignored: theme\.accent/)).toBeDefined();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    const staged = stageWorkspaceUpdate.mock.calls[0]?.[0] as WorkspaceSnapshot;
    // Unchecked → nothing applied, preferences untouched.
    expect(staged.preferences).toEqual(workspace.preferences);
  });

  it("hides the theme offer entirely when every theme field is illegal", async () => {
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    await pasteAndParse(
      view,
      deckText({ theme: { mode: "blue", accent: -5, material: "diamond" }, motion: undefined })
    );
    expect(view.queryByRole("checkbox")).toBeNull();
    await act(async () => {
      fireEvent.click(view.getByText("4 notices"));
    });
    expect(view.getByText(/Invalid theme field ignored: theme\.mode/)).toBeDefined();
    expect(view.getByText(/Invalid theme field ignored: theme\.accent/)).toBeDefined();
    expect(view.getByText(/Invalid theme field ignored: theme\.material/)).toBeDefined();
  });
});

describe("ImportJsonDialog: recipe embedded wallpapers (D1)", () => {
  const PNG_BYTES = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));

  /** A deck whose "Shots" space references an asset embedded in `assets`. */
  async function embeddedDeck(mediaType = "image/png"): Promise<{ text: string; id: string }> {
    const digest = await crypto.subtle.digest("SHA-256", PNG_BYTES);
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const id = `asset-sha256-${hex}`;
    const text = JSON.stringify({
      format: "vela.recipe",
      version: 1,
      spaces: [{ name: "Shots", layout: "grid", wallpaper: { dark: `asset:${id}` }, tiles: [] }],
      plugins: [],
      assets: { [id]: { mediaType, data: Buffer.from(PNG_BYTES).toString("base64") } },
    });
    return { text, id };
  }

  function stubBitmap(width = 800, height = 600): void {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width, height, close: () => {} })),
    );
  }

  it("previews an embedded wallpaper, stages its bytes once and lands the asset ref", async () => {
    stubBitmap();
    const deck = await embeddedDeck();
    assetsGateway.stageAsset.mockResolvedValue({
      ok: true,
      status: "staged",
      record: { id: deck.id, blob: new Blob([]), mediaType: "image/png", byteLength: PNG_BYTES.byteLength, createdAt: 0, syncState: "pending" },
    });
    const stageWorkspaceUpdate = vi.fn((snapshot: WorkspaceSnapshot) => {
      void snapshot;
      return Promise.resolve({ ok: true });
    });
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })) }),
    );
    await pasteAndParse(view, deck.text);
    expect(view.getByText("Snap · default grid · 0 tiles · Dark wallpaper: embedded image")).toBeDefined();
    // Embedded ≠ cloud: no download list, no probe hit needed.
    expect(view.queryByText(/Wallpapers needing download/)).toBeNull();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    // The verified bytes were staged through the asset runtime exactly once
    // (jsdom's Blob lacks arrayBuffer — byte equality is covered in the
    // node-env recipe-assets suite; here type + size pin the wiring).
    expect(assetsGateway.stageAsset).toHaveBeenCalledTimes(1);
    const stagedBlob = assetsGateway.stageAsset.mock.calls[0]?.[0] as Blob;
    expect(stagedBlob.type).toBe("image/png");
    expect(stagedBlob.size).toBe(PNG_BYTES.byteLength);
    // …never fetched remotely, and the ONE revision carries the asset ref.
    expect(assetsGateway.loadAsset).not.toHaveBeenCalled();
    const staged = stageWorkspaceUpdate.mock.calls[0]?.[0] as WorkspaceSnapshot;
    expect(staged.pages.find((page) => page.name === "Shots")?.wallpaperByMode).toEqual({
      dark: { kind: "asset", assetId: deck.id, fit: "cover", position: "center" },
    });
    expect(view.queryByText(/fell back to the preset/)).toBeNull();
  });

  it("leaves the workspace untouched when embedded asset staging fails", async () => {
    stubBitmap();
    const deck = await embeddedDeck();
    assetsGateway.stageAsset.mockResolvedValue({ ok: false, reason: "storage-error" });
    const stageWorkspaceUpdate = vi.fn();
    const syncCurrent = vi.fn();
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime({ stageWorkspaceUpdate, syncCurrent }));
    await pasteAndParse(view, deck.text);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Saving the embedded wallpapers failed; please try again.")).toBeDefined());
    expect(stageWorkspaceUpdate).not.toHaveBeenCalled();
    expect(syncCurrent).not.toHaveBeenCalled();
  });

  it("requires review when the workspace changes during cloud IO", async () => {
    let resolveLoad!: (result: { ok: false; reason: string }) => void;
    assetsGateway.loadAsset.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const workspace = officeWorkspace().workspace;
    const stageWorkspaceUpdate = vi.fn();
    const { view, rerender } = renderDialog(workspace, makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn() }));
    const id = `asset-sha256-${"b".repeat(64)}`;
    await pasteAndParse(view, JSON.stringify({
      format: "vela.recipe", version: 1, plugins: [],
      spaces: [{ name: "AI", layout: "grid", wallpaper: { dark: `asset:${id}` }, tiles: [{ name: "A", url: "https://a.example/" }] }],
    }));
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Import" })); });
    await waitFor(() => expect(assetsGateway.loadAsset).toHaveBeenCalled());
    rerender(addApp(workspace, "page-office", "app-a", "A", "https://a.example/"));
    await act(async () => { resolveLoad({ ok: false, reason: "not-found" }); });
    await waitFor(() => expect(view.getByText("The workspace changed. Please review the import again.")).toBeDefined());
    expect(stageWorkspaceUpdate).not.toHaveBeenCalled();
  });

  it("lists a non-embedded ref as needing download, then falls back to the preset when the fetch fails", async () => {
    const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;
    const stageWorkspaceUpdate = vi.fn((snapshot: WorkspaceSnapshot) => {
      void snapshot;
      return Promise.resolve({ ok: true });
    });
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })) }),
    );
    await pasteAndParse(
      view,
      JSON.stringify({
        format: "vela.recipe",
        version: 1,
        spaces: [{ name: "Shots", layout: "grid", wallpaper: { light: "preset:aurora", dark: `asset:${NIGHT_ID}` }, tiles: [] }],
        plugins: [],
      }),
    );
    // Preview: neither embedded nor local → the download list names it.
    expect(view.getByText("Wallpapers needing download (1)")).toBeDefined();
    expect(view.getByText("Shots · Dark")).toBeDefined();
    expect(assetsGateway.getLocalAsset).toHaveBeenCalledWith(NIGHT_ID);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    // The fetch was attempted (default mock: not-found) and the ref fell back.
    expect(assetsGateway.loadAsset).toHaveBeenCalledWith(NIGHT_ID);
    const staged = stageWorkspaceUpdate.mock.calls[0]?.[0] as WorkspaceSnapshot;
    expect(staged.pages.find((page) => page.name === "Shots")?.wallpaperByMode).toEqual({
      light: { kind: "preset", presetId: "aurora" },
      dark: { kind: "preset", presetId: "dawn" },
    });
    expect(view.getByText("1 wallpapers could not be fetched and fell back to the preset.")).toBeDefined();
    expect(view.getByText("Shots · Dark")).toBeDefined();
  });

  it("resolves a non-embedded ref from the cloud at confirm time", async () => {
    const NIGHT_ID = `asset-sha256-${"b".repeat(64)}`;
    assetsGateway.loadAsset.mockResolvedValue({ ok: true, blob: new Blob(["x"]), mediaType: "image/png", source: "remote" });
    const stageWorkspaceUpdate = vi.fn((snapshot: WorkspaceSnapshot) => {
      void snapshot;
      return Promise.resolve({ ok: true });
    });
    const { view } = renderDialog(
      officeWorkspace().workspace,
      makeRuntime({ stageWorkspaceUpdate, syncCurrent: vi.fn(() => Promise.resolve({ status: "synced" })) }),
    );
    await pasteAndParse(
      view,
      JSON.stringify({
        format: "vela.recipe",
        version: 1,
        spaces: [{ name: "Shots", layout: "grid", wallpaper: { dark: `asset:${NIGHT_ID}` }, tiles: [] }],
        plugins: [],
      }),
    );
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Import" }));
    });
    await waitFor(() => expect(view.getByText("Imported")).toBeDefined());
    const staged = stageWorkspaceUpdate.mock.calls[0]?.[0] as WorkspaceSnapshot;
    expect(staged.pages.find((page) => page.name === "Shots")?.wallpaperByMode).toEqual({
      dark: { kind: "asset", assetId: NIGHT_ID, fit: "cover", position: "center" },
    });
    expect(view.queryByText(/fell back to the preset/)).toBeNull();
  });

  it("blocks an invalid embedded asset at input with its reason and path", async () => {
    stubBitmap();
    const deck = await embeddedDeck("image/jpeg"); // PNG bytes declared image/jpeg
    const { view } = renderDialog(officeWorkspace().workspace, makeRuntime());
    await pasteAndParse(view, deck.text);
    const alert = view.getByRole("alert");
    expect(alert.textContent).toContain("Invalid embedded wallpaper asset (magic bytes disagree with the declared media type)");
    expect(alert.textContent).toContain(`assets.asset-sha256-${deck.id.slice("asset-sha256-".length, "asset-sha256-".length + 12)}…`);
    expect(view.queryByText("Ready to import")).toBeNull();
    expect(assetsGateway.stageAsset).not.toHaveBeenCalled();
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
