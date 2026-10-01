// @vitest-environment jsdom
/*
 * Task 021-R1 Part A — the canonical theme-boundary regression.
 *
 * The defect: HeroUI's Select popover (a react-aria-components Overlay)
 * portalled to `document.body`, OUTSIDE both themed `[data-vd-ui]` roots.
 * A body-mounted popup inherits the always-dark `:root` token fallback for
 * its surface while its text `color` falls back to the UA default — nearly
 * black text on a dark surface in dark mode, and a permanently dark popup
 * in light mode.
 *
 * These tests mount the REAL SettingsCenter inside the shell's documented
 * theme wiring (a themed desktop root + a themed portal root exposed
 * through VdPortalContainerProvider + VdHeroOverlayScope), open the real
 * HeroUI Select through its user-facing trigger, and assert that the real
 * popup/option DOM lands INSIDE the themed boundary and that
 * selection/focus integration works. Structure and callback integration
 * only — jsdom cannot compute CSS custom properties, so final painted
 * colors stay with the pure token-contract tests and the user's manual
 * check.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { DesktopPage, WorkspaceSnapshot } from "@veladesk/domain";

import { UI_LOCALE_STORAGE_KEY } from "../i18n/locale";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import {
  VdHeroOverlayScope,
  VdPortalContainerProvider,
} from "@components/ui/overlay-scope";
import { SettingsCenter } from "./settings-center";

beforeAll(() => {
  // The locale module caches its read, so seed English before any render.
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "en-US");
});

afterEach(() => {
  cleanup();
});

/** A two-page workspace so the default-section Select has a real choice. */
function twoPageWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws",
    workspaceName: "Test",
    pageId: "page-a",
    pageName: "Alpha",
    grid: { columns: 6, rows: 4 },
  });
  const second: DesktopPage = {
    ...base.pages[0]!,
    id: "page-b",
    name: "Beta",
    layout: { ...base.pages[0]!.layout, id: "page-b" },
  };
  return { ...base, pages: [base.pages[0]!, second] };
}

/**
 * Mirrors DesktopShell's theme wiring exactly: a themed desktop root whose
 * subtree hosts the settings window, a themed portal-root sibling, and the
 * portal container context established by a ref callback (the shell's
 * `setPortalRoot` pattern). Mode flips re-render this host in place — the
 * portal root ELEMENT must survive them (live preview and Cancel never
 * recreate containers).
 */
function ThemedHost(props: { readonly mode: "dark" | "light"; readonly children: React.ReactNode }) {
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  return (
    <VdPortalContainerProvider value={portalRoot}>
      <div data-vd-ui="" data-vd-color-mode={props.mode} data-testid="desktop-root">
        <VdHeroOverlayScope>{props.children}</VdHeroOverlayScope>
      </div>
      <div
        ref={setPortalRoot}
        data-vd-ui=""
        data-vd-portal-root=""
        data-vd-color-mode={props.mode}
        data-testid="portal-root"
      />
    </VdPortalContainerProvider>
  );
}

function renderSettings(mode: "dark" | "light", workspace = twoPageWorkspace()) {
  return render(
    <UiLocaleProvider>
      <ThemedHost mode={mode}>
        <SettingsCenter
          open={true}
          workspace={workspace}
          onPreviewAppearance={() => {}}
          onSave={async () => ({ ok: true as const })}
          onClose={() => {}}
        />
      </ThemedHost>
    </UiLocaleProvider>,
  );
}

/** Settings opens on Appearance; the section Select lives under Layout. */
async function openDefaultPageSelect() {
  fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
  // The pane swap is a Motion wait-mode cross-fade (~220ms design, slower
  // under jsdom timers) — the swap latency is not what this test measures.
  // (RTL's role/name computation can't resolve the RAC trigger's name here,
  // so the label query is used instead.)
  const trigger = await screen.findByLabelText("Default section", {}, { timeout: 5000 });
  fireEvent.click(trigger);
  return trigger;
}

function popoverInPortalRoot(portalRoot: HTMLElement): HTMLElement | null {
  const popover = document.querySelector<HTMLElement>('[data-slot="select-popover"]');
  if (popover === null) {
    return null;
  }
  return popover.closest<HTMLElement>("[data-vd-portal-root]") === portalRoot ? popover : null;
}

describe("Settings theme boundary (021-R1)", () => {
  it("opens the default-section Select inside the themed portal root (dark)", async () => {
    renderSettings("dark");
    const trigger = await openDefaultPageSelect();

    const portalRoot = document.querySelector<HTMLElement>('[data-testid="portal-root"]')!;
    const popover = popoverInPortalRoot(portalRoot);
    expect(popover, "Select popup must mount inside the themed portal root").not.toBeNull();

    // The option rows are real list-box items inside the same boundary…
    const options = popover!.querySelectorAll<HTMLElement>('[data-slot="list-box-item"]');
    expect(options.length).toBeGreaterThanOrEqual(2);
    // …and the boundary the popup inherited from is the dark one.
    expect(popover!.closest<HTMLElement>("[data-vd-ui]")!.dataset.vdColorMode).toBe("dark");

    // Selecting an option updates the field, closes the popup and returns
    // focus to the trigger.
    fireEvent.click(options[1]!);
    expect(trigger.textContent).toContain("Beta");
    expect(document.querySelector('[data-slot="select-popover"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens the Select inside the themed portal root (light) with the light boundary", async () => {
    renderSettings("light");
    await openDefaultPageSelect();

    const portalRoot = document.querySelector<HTMLElement>('[data-testid="portal-root"]')!;
    const popover = popoverInPortalRoot(portalRoot);
    expect(popover, "Select popup must mount inside the themed portal root").not.toBeNull();
    expect(popover!.closest<HTMLElement>("[data-vd-ui]")!.dataset.vdColorMode).toBe("light");
  });

  it("keeps the portal container stable across a live theme preview flip and re-theme the popup", async () => {
    const { rerender } = renderSettings("dark");
    await openDefaultPageSelect();

    const before = document.querySelector<HTMLElement>('[data-testid="portal-root"]')!;
    const popoverBefore = popoverInPortalRoot(before);
    expect(popoverBefore).not.toBeNull();

    // Live preview flips the resolved mode on BOTH themed roots; the
    // containers are never recreated.
    rerender(
      <UiLocaleProvider>
        <ThemedHost mode="light">
          <SettingsCenter
            open={true}
            workspace={twoPageWorkspace()}
            onPreviewAppearance={() => {}}
            onSave={async () => ({ ok: true as const })}
            onClose={() => {}}
          />
        </ThemedHost>
      </UiLocaleProvider>,
    );

    const after = document.querySelector<HTMLElement>('[data-testid="portal-root"]')!;
    expect(after).toBe(before);
    const popoverAfter = popoverInPortalRoot(after);
    expect(popoverAfter).not.toBeNull();
    expect(popoverAfter!.closest<HTMLElement>("[data-vd-ui]")!.dataset.vdColorMode).toBe("light");
  });

  it("mounts the popup as a descendant of the OPEN DIALOG ITSELF (Radix modal interop)", async () => {
    // While a Radix modal dialog is open, react-remove-scroll puts
    // `pointer-events: none` on body and only the dialog's own subtree
    // re-enables it; Radix also treats pointerdown outside the dialog as
    // outside-dismissal. A HeroUI popup portalled ANYWHERE ELSE than into
    // the dialog's content element therefore renders but can never be
    // clicked (and would dismiss the Settings window). The popup must be a
    // DOM descendant of the [role=dialog] element.
    renderSettings("dark");
    await openDefaultPageSelect();

    // (The RAC Popover itself also carries role="dialog"; document order
    // makes the Radix window the first match, and containment is the real
    // assertion.)
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const popover = document.querySelector<HTMLElement>('[data-slot="select-popover"]');
    expect(popover).not.toBeNull();
    expect(
      dialog!.contains(popover!),
      "the popup must live inside the dialog content (pointer events + dismissal + focus scope)",
    ).toBe(true);

    // It still shares the themed portal root by ancestry — the dialog is
    // portalled there, so the popup inherits the same effective theme.
    expect(
      popover!.closest<HTMLElement>("[data-vd-portal-root]"),
    ).toBe(dialog!.closest<HTMLElement>("[data-vd-portal-root]"));

    // And the selection interaction still completes end to end.
    const options = popover!.querySelectorAll<HTMLElement>('[data-slot="list-box-item"]');
    fireEvent.click(options[1]!);
    expect(document.querySelector('[data-slot="select-popover"]')).toBeNull();
  });
});
