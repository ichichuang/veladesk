// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createEmptyWorkspace, type WallpaperConfig } from "@veladesk/domain";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { UI_LOCALE_STORAGE_KEY } from "../i18n/locale";
import { BackgroundImageThumbnail } from "./background-image-thumbnail";
import { SettingsCenter } from "./settings-center";

const mocks = vi.hoisted(() => ({ loadAsset: vi.fn(), prepareWallpaperImage: vi.fn() }));
vi.mock("../assets/browser-assets", () => ({ getBrowserAssetRuntime: async () => mocks }));
vi.mock("./wallpaper-prep", () => ({ prepareWallpaperImage: mocks.prepareWallpaperImage }));
const saved: WallpaperConfig = { kind: "asset", assetId: "saved", fit: "contain", position: "center" };
const candidate = { asset: { id: "new", blob: new Blob(["new"]), mediaType: "image/png", byteLength: 3 }, previewUrl: "blob:new", width: 20, height: 10 };

beforeEach(() => {
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
  Element.prototype.scrollIntoView = () => {};
  mocks.loadAsset.mockReset().mockResolvedValue({ ok: true, blob: new Blob(["saved"]) });
  mocks.prepareWallpaperImage.mockReset().mockResolvedValue({ ok: true, image: candidate });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:saved");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function settings(scope: "workspace" | "page-1" = "workspace") {
  const base = createEmptyWorkspace({ workspaceId: "ws", workspaceName: "W", pageId: "page-1", pageName: "Alpha", grid: { columns: 3, rows: 3 } });
  const workspace = scope === "workspace"
    ? { ...base, preferences: { ...base.preferences, appearance: { ...base.preferences.appearance!, wallpaper: saved } } }
    : { ...base, pages: base.pages.map(p => ({ ...p, wallpaper: saved })) };
  function Session({ open }: { open: boolean }) {
    return <UiLocaleProvider><SettingsCenter open={open} workspace={workspace} backgroundEntrySectionId={scope === "workspace" ? null : scope}
      onPreviewAppearance={() => {}} onSave={async () => ({ ok: true })} onClose={close} /></UiLocaleProvider>;
  }
  const close = vi.fn(() => view.rerender(<Session open={false} />));
  const view = render(<Session open />);
  return { ...view, close, reopen: () => view.rerender(<Session open />) };
}

async function savedImage(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.getByAltText("Background image preview").getAttribute("src")).toBe("blob:saved"));
  return view.getByAltText("Background image preview");
}
async function choose(view: ReturnType<typeof render>) {
  fireEvent.change(view.getByTestId("wallpaper-file-input"), { target: { files: [new File(["new"], "new.png", { type: "image/png" })] } });
  await waitFor(() => expect(view.getByAltText("Background image preview").getAttribute("src")).toBe("blob:new"));
}

describe("saved background thumbnail", () => {
  it.each(["workspace", "page-1"] as const)("loads the saved %s image with its fit and a loading skeleton", async scope => {
    const view = settings(scope);
    expect(view.getByRole("status", { name: "Loading image" })).toBeTruthy();
    const image = await savedImage(view);
    expect(mocks.loadAsset).toHaveBeenCalledWith("saved");
    expect(image.style.objectFit).toBe("contain");
    fireEvent.load(image);
    expect(view.queryByRole("status", { name: "Loading image" })).toBeNull();
  });
  it("switches to the pending image, updates fit, removes it and releases both URLs", async () => {
    const view = settings();
    await savedImage(view);
    await choose(view);
    expect(view.getByText("Unsaved")).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:saved");
    fireEvent.click(view.getByRole("radio", { name: "Show entire image" }));
    expect(view.getByAltText("Background image preview").style.objectFit).toBe("contain");
    fireEvent.click(view.getByRole("button", { name: "Remove image" }));
    expect(view.getByText("No image set")).toBeTruthy();
    expect(view.queryByAltText("Background image preview")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:new");
  });
  it.each(["cancel", "escape"])("restores the saved image after %s and reopening", async method => {
    const view = settings();
    await savedImage(view);
    await choose(view);
    if (method === "cancel") fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(view.close).toHaveBeenCalled());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:new");
    view.reopen();
    await savedImage(view);
    expect(view.queryByText("Unsaved")).toBeNull();
  });
  it("shows image decode errors and revokes its saved URL on unmount", async () => {
    const view = settings();
    fireEvent.error(await savedImage(view));
    expect(view.getByText("Unable to load image")).toBeTruthy();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:saved");
  });
  it.each(["missing", "rejected"])("shows a resource failure: %s", async reason => {
    if (reason === "missing") mocks.loadAsset.mockResolvedValue({ ok: false });
    else mocks.loadAsset.mockRejectedValue(new Error("offline"));
    const view = settings();
    await waitFor(() => expect(view.getByText("Unable to load image")).toBeTruthy());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("releases a pending URL on unmount", async () => {
    const view = settings();
    await choose(view);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:new");
  });
  it("releases an image whose preparation finishes after cancellation", async () => {
    let resolve!: (value: unknown) => void;
    mocks.prepareWallpaperImage.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = settings();
    await savedImage(view);
    fireEvent.change(view.getByTestId("wallpaper-file-input"), { target: { files: [new File(["new"], "new.png")] } });
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    await act(async () => resolve({ ok: true, image: candidate }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:new");
    view.reopen();
    await savedImage(view);
    expect(view.queryByText("Unsaved")).toBeNull();
  });
  it("does not create a URL for a late response after unmount", async () => {
    let resolve!: (value: unknown) => void;
    mocks.loadAsset.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = render(<UiLocaleProvider><BackgroundImageThumbnail config={saved} pending={null} /></UiLocaleProvider>);
    await waitFor(() => expect(mocks.loadAsset).toHaveBeenCalled());
    view.unmount();
    await act(async () => resolve({ ok: true, blob: new Blob(["late"]) }));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
