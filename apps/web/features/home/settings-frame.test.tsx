// @vitest-environment jsdom
/*
 * Task 023-R2 — the Settings frame's REAL size ownership, wiring level.
 *
 * Renders the real SettingsCenter through the real shared Dialog → Radix
 * Content (outer positioning node) → VdAnimatedSurface (the painted
 * window) composition. What jsdom proves here is WIRING:
 *
 *  - exactly ONE painted node carries `data-settings-surface` — the size
 *    owner the canonical home-shell.css rule keys on (the rule text itself
 *    is pinned by settings-center.test.ts, which parses the production
 *    CSS: width 880px, height 680px, viewport clamps, three grid rows);
 *  - the surface, header, footer and the single scroll owner keep their
 *    DOM identities across every tab switch — the frame is never
 *    re-keyed or remounted by the active tab;
 *  - no React/GSAP inline style ever overrides the frame geometry — the
 *    surface's inline style may carry GSAP's transform/opacity only;
 *  - the contract is Settings-specific: another small dialog's painted
 *    surface never carries the marker.
 *
 * jsdom does not measure browser geometry — the settled 880×680 check
 * across tabs remains the human's acceptance (the §24 checklist).
 *
 * History: 023-R1 sized the painted node through a min() rule while the
 * shared dialog still hung `flex-1` (percentage flex basis) on it inside
 * the auto-height `w-max` flex column, and keyed the rule on the generic
 * `data-vd-surface` marker. 023-R2 replaces that with the explicit
 * definite-size contract and a dedicated marker (see home-shell.css).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";

import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { UI_LOCALE_STORAGE_KEY } from "../i18n/locale";

// The upload VALIDATOR is the injected seam for the error-path test: jsdom
// Blobs lack arrayBuffer(), so the real core cannot run here. Everything
// under test (the SettingsCenter error wiring and frame identity) is real.
const wallpaperPrep = vi.hoisted(() => ({
  prepareWallpaperImage: vi.fn(),
}));
vi.mock("./wallpaper-prep", () => wallpaperPrep);
import { SettingsCenter } from "./settings-center";
import { ConfirmDialog } from "./confirm-dialog";
import { VdPortalContainerProvider } from "@components/ui/overlay-scope";

function workspace() {
  return createEmptyWorkspace({
    workspaceId: "ws-1",
    workspaceName: "W",
    pageId: "page-1",
    pageName: "Alpha",
    grid: { columns: 3, rows: 3 },
  });
}

/** The outer positioning node Radix placed (carries data-settings-dialog). */
function settingsPositioningNode(): HTMLElement {
  const node = document.querySelector("[data-settings-dialog]");
  if (!(node instanceof HTMLElement)) {
    throw new Error("settings positioning node not rendered");
  }
  return node;
}

/** The PAINTED window surface — the ONE marked size owner. */
function paintedSettingsSurface(): HTMLElement {
  const surface = settingsPositioningNode().querySelector(
    ":scope > [data-settings-surface]",
  );
  if (!(surface instanceof HTMLElement)) {
    throw new Error("marked settings surface not under the positioning node");
  }
  return surface;
}

function renderSettings(): ReturnType<typeof render> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return render(
    <VdPortalContainerProvider value={host}>
      <UiLocaleProvider>
        <SettingsCenter
          open={true}
          workspace={workspace()}
          onPreviewAppearance={() => {}}
          onSave={async () => ({ ok: true })}
          onClose={() => {}}
          activeSectionId="page-1"
        />
      </UiLocaleProvider>
    </VdPortalContainerProvider>,
  );
}

async function switchTab(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name }));
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  // English labels so getByRole names are deterministic.
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
});

beforeEach(() => {
  wallpaperPrep.prepareWallpaperImage.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the fixed frame reaches the ONE marked painted surface (023-R2)", () => {
  it("exactly one painted surface carries the size-owner marker, as the positioning node's child", () => {
    renderSettings();
    const marked = document.querySelectorAll("[data-settings-surface]");
    expect(marked).toHaveLength(1);
    // It IS the painted window surface (bg/border/radius), a direct child
    // of the outer positioning node — the shape the canonical rule keys.
    expect(marked[0]).toBe(paintedSettingsSurface());
    expect(settingsPositioningNode().querySelector(":scope > [data-vd-surface]")).toBe(
      marked[0],
    );
  });

  it("the frame is the three-row window: header, constrained body, fixed footer", () => {
    renderSettings();
    const surface = paintedSettingsSurface();

    // The three frame rows exist as the surface's structural children.
    expect(surface.querySelector(":scope > header")).not.toBeNull();
    expect(surface.querySelector(":scope > footer")).not.toBeNull();

    // The body row: fixed nav column + the ONE content scroll owner.
    const scrollers = surface.querySelectorAll("[data-vd-scroll]");
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]!.getAttribute("data-vd-scroll")).toBe("y");
    const nav = surface.querySelector("nav");
    expect(nav?.className).toMatch(/w-\[160px\]/);
    expect(nav?.className).toMatch(/min-h-0/);
  });

  it("surface, header, footer and scroll owner keep their identities across every tab switch", async () => {
    renderSettings();
    const surface = paintedSettingsSurface();
    expect(surface.getAttribute("data-settings-surface")).toBe("");
    const header = surface.querySelector("header");
    const footer = surface.querySelector("footer");
    const scroller = surface.querySelector("[data-vd-scroll]");
    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(scroller).not.toBeNull();

    let previousSection: string | null = surface
      .querySelector("[data-settings-section]")
      ?.getAttribute("data-settings-section") ?? null;

    for (const tab of ["Layout", "General", "Appearance", "Layout", "Appearance"]) {
      await switchTab(tab);
      // Still exactly one marked surface, the SAME node — never re-keyed.
      expect(document.querySelectorAll("[data-settings-surface]")).toHaveLength(1);
      expect(paintedSettingsSurface()).toBe(surface);
      expect(surface.querySelector("header")).toBe(header);
      expect(surface.querySelector("footer")).toBe(footer);
      expect(surface.querySelector("[data-vd-scroll]")).toBe(scroller);
      // The tab switch really swapped the pane (a real change assertion).
      const section = surface
        .querySelector("[data-settings-section]")
        ?.getAttribute("data-settings-section");
      expect(section).toBe(tab.toLowerCase());
      expect(section).not.toBe(previousSection);
      previousSection = section ?? null;
    }
  });

  it("no inline style ever overrides the frame geometry; only GSAP's transform/opacity may appear", async () => {
    renderSettings();
    const surface = paintedSettingsSurface();

    const assertGeometryNeverInlined = () => {
      const style = surface.style;
      const written: string[] = [];
      for (let i = 0; i < style.length; i += 1) {
        written.push(style.item(i));
      }
      // GSAP entrance pose (transform/opacity) is allowed; nothing else.
      expect(written.every((prop) => prop === "transform" || prop === "opacity"))
        .toBe(true);
      // The canonical size contract lives ONLY in the stylesheet rule.
      expect(style.width).toBe("");
      expect(style.height).toBe("");
      expect(style.maxWidth).toBe("");
      expect(style.maxHeight).toBe("");
    };

    assertGeometryNeverInlined();
    await switchTab("Layout");
    assertGeometryNeverInlined();
    await switchTab("General");
    assertGeometryNeverInlined();
    await switchTab("Appearance");
    assertGeometryNeverInlined();
  });

  it("the exact frame contract is Settings-specific: another dialog never carries the marker", () => {
    render(
      <UiLocaleProvider>
        <ConfirmDialog title="Delete" message="Sure?" onConfirm={() => {}} onCancel={() => {}} />
      </UiLocaleProvider>,
    );
    // No settings marker anywhere; the confirm dialog keeps the generic
    // painted surface and no settings positioning node exists.
    expect(document.querySelectorAll("[data-settings-surface]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-settings-dialog]")).toHaveLength(0);
    const alertDialogSurface = document.querySelector("[data-vd-surface]");
    expect(alertDialogSurface).not.toBeNull();
    expect(alertDialogSurface!.getAttribute("data-settings-surface")).toBeNull();
  });

  it("a tab change resets the content pane's scroll exactly once; rerenders do not", async () => {
    renderSettings();
    const pane = paintedSettingsSurface().querySelector("[data-settings-pane]") as HTMLElement;
    // Element-level scrollTop seam: jsdom has no layout; what is under
    // test is WHICH interactions write scroll position, not geometry.
    let recordedScrollTop = 0;
    Object.defineProperty(pane, "scrollTop", {
      get: () => recordedScrollTop,
      set: (value: number) => {
        recordedScrollTop = value;
      },
      configurable: true,
    });
    recordedScrollTop = 300;

    // A tab CHANGE resets exactly once so the new pane starts at its
    // heading (the window opens on Appearance; switch away and back).
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
    });
    expect(recordedScrollTop).toBe(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    });
    expect(recordedScrollTop).toBe(0);

    // Draft changes (a preset pick) and unrelated rerenders never touch it.
    recordedScrollTop = 260;
    await act(async () => {
      fireEvent.click(screen.getByTestId("wallpaper-preset-mist"));
    });
    expect(recordedScrollTop).toBe(260);
  });

  it("the background editor order: scope, inheritance, Choose image, then the compact presets", async () => {
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    });
    const scope = document.querySelector('[aria-label="Editing background for"]');
    const imageRow = document.querySelector('[data-testid="background-image-row"]');
    const choose = screen.queryByRole("button", { name: /Choose image/ });
    const grid = document.querySelector('[data-testid="wallpaper-preset-grid"]');

    expect(scope).not.toBeNull();
    expect(imageRow).not.toBeNull();
    expect(choose).not.toBeNull();
    expect(grid).not.toBeNull();
    // scope < image row < preset grid in RENDERED order.
    expect(
      (scope as Node).compareDocumentPosition(imageRow!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (imageRow as Node).compareDocumentPosition(grid!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Compact art: the preset thumbnails paint in the fixed-height art band
    // (the full-desktop 16:9 preview class is gone), pointer-transparent.
    const art = grid!.querySelector(".vela-wallpaper-surface--thumb-art");
    expect(art).not.toBeNull();
    expect(grid!.querySelector(".vela-wallpaper-surface--thumbnail")).toBeNull();

    // The effective upload cap renders from the shared core constant (4 MiB).
    expect(screen.getByText(/4 MiB/)).toBeDefined();
  });

  it("an upload validation error never remounts the frame", async () => {
    renderSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    });
    const surface = paintedSettingsSurface();
    const input = document.querySelector('[data-testid="wallpaper-file-input"]');

    // The validator seam refuses the selection.
    wallpaperPrep.prepareWallpaperImage.mockResolvedValue({
      ok: false,
      issue: "unsupported-image-type",
    });
    const file = new File(["not a png"], "x.png", { type: "image/png" });
    Object.defineProperty(input!, "files", { value: [file] });
    await act(async () => {
      fireEvent.change(input!);
    });
    // The async validation lands; the inline error renders INSIDE the same
    // frame — no unmount/remount.
    await waitFor(() => {
      expect(surface.querySelector('[role="alert"]')).not.toBeNull();
    });
    expect(paintedSettingsSurface()).toBe(surface);
  });
});
