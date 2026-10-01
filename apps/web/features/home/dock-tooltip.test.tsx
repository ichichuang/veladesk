// @vitest-environment jsdom
/*
 * Task 023-B.1 — the Dock application-name tooltip regression.
 *
 * The real Dock (real VdTooltip + Radix Trigger asChild + portal + GSAP
 * surface + hover-lift composition) with real jsdom events. Only TIME is
 * controlled: fake timers advance the intentional ~220ms open delay and
 * the provider's skip/close behavior deterministically. jsdom cannot prove
 * painted positioning or collision placement — those stay with manual
 * acceptance.
 *
 * The pre-023-B.1 defect this file pins: DockEntityButton dropped the
 * Trigger's injected ref/props (hover + focus signals never reached the
 * button), so the tooltip could not open at all.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createEmptyWorkspace } from "@veladesk/domain";
import type { AppShortcut, Folder, WorkspaceSnapshot } from "@veladesk/domain";

import { Dock } from "./dock";
import { VD_TOOLTIP_OPEN_DELAY_MS } from "@components/vd/tooltip";

function app(id: string, name: string): AppShortcut {
  return {
    kind: "app",
    id,
    name,
    url: "https://example.com/",
    icon: { kind: "generated", text: name.slice(0, 2).toUpperCase() },
    openMode: "new-tab",
    tags: [],
  };
}

function folder(id: string, name: string): Folder {
  return { kind: "folder", id, name, children: [] };
}

function dockedWorkspace(): WorkspaceSnapshot {
  const base = createEmptyWorkspace({
    workspaceId: "ws-1",
    workspaceName: "Desk",
    pageId: "page-1",
    pageName: "Home",
    grid: { columns: 3, rows: 3 },
  });
  return {
    ...base,
    entities: [app("app-a", "Vela Notes"), folder("folder-1", "Projects")],
    dock: { items: ["app-a", "folder-1"] },
  };
}

function dockButton(name: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label^="${name}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`dock button not found for ${name}`);
  }
  return button;
}

function openTooltip(): HTMLElement {
  const tooltip = document.querySelector('[role="tooltip"]');
  if (!(tooltip instanceof HTMLElement)) {
    throw new Error("tooltip content not mounted");
  }
  return tooltip;
}

function renderDock(): ReturnType<typeof render> {
  return render(
    <Dock
      workspace={dockedWorkspace()}
      onOpenFolder={() => {}}
      onEntityContextMenu={() => {}}
      onDesktopContextMenu={() => {}}
    />,
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("dock tooltip identity (023-B.1)", () => {
  it("shows the app's real name above its button after the intentional delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDock();
    const button = dockButton("打开 Vela Notes");

    await act(async () => {
      fireEvent.pointerMove(button);
    });
    await act(async () => {
      vi.advanceTimersByTime(VD_TOOLTIP_OPEN_DELAY_MS + 40);
    });
    expect(openTooltip().textContent).toBe("Vela Notes");
  });

  it("keyboard focus shows the same name without any mouse", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDock();
    const button = dockButton("打开 Vela Notes");

    await act(async () => {
      fireEvent.focus(button);
    });
    await act(async () => {
      vi.advanceTimersByTime(VD_TOOLTIP_OPEN_DELAY_MS + 40);
    });
    expect(openTooltip().textContent).toBe("Vela Notes");
  });

  it("a dock folder shows its own name the same way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDock();
    const button = dockButton("打开文件夹 Projects");

    await act(async () => {
      fireEvent.pointerMove(button);
    });
    await act(async () => {
      vi.advanceTimersByTime(VD_TOOLTIP_OPEN_DELAY_MS + 40);
    });
    expect(openTooltip().textContent).toBe("Projects");
  });

  it("Escape dismisses; re-entering the same button re-opens", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDock();
    const button = dockButton("打开 Vela Notes");

    await act(async () => {
      fireEvent.pointerMove(button);
    });
    await act(async () => {
      vi.advanceTimersByTime(VD_TOOLTIP_OPEN_DELAY_MS + 40);
    });
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();

    // Radix closes pointer-leaves through a pointer-tracked grace area,
    // which jsdom's coordinate-less events cannot drive; Escape is the
    // deterministic dismissal seam (a real leave closes the same state).
    await act(async () => {
      fireEvent.keyDown(button, { key: "Escape" });
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    // Re-entry: leave first (resets Radix's pointer-inside-trigger
    // tracking), then move back over the button.
    await act(async () => {
      fireEvent.pointerLeave(button);
    });
    await act(async () => {
      fireEvent.pointerMove(button);
    });
    await act(async () => {
      vi.advanceTimersByTime(VD_TOOLTIP_OPEN_DELAY_MS + 40);
    });
    expect(openTooltip().textContent).toBe("Vela Notes");
  });

  it("the tooltip never suppresses launch: a click still opens the app exactly once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      renderDock();
      const button = dockButton("打开 Vela Notes");

      await act(async () => {
        fireEvent.pointerMove(button);
      });
      await act(async () => {
        vi.advanceTimersByTime(VD_TOOLTIP_OPEN_DELAY_MS + 40);
      });
      expect(openTooltip().textContent).toBe("Vela Notes");

      await act(async () => {
        fireEvent.click(button);
      });
      expect(openSpy).toHaveBeenCalledTimes(1);
    } finally {
      openSpy.mockRestore();
    }
  });
});
