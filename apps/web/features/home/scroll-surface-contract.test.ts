import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Task 021-A scroll contracts: one canonical scroll component emitting
 * `data-vd-scroll`, token-layer-only scrollbar styling, every core
 * scroller migrated, NO global wildcard scrollbar CSS, the desktop root
 * never a scroller, no React per-scroll state anywhere, and the section
 * rail's wheel ownership untouched (019/020 exception).
 */

function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

/** The apps/web root — for components/ and app/ files. */
const webRoot = fileURLToPath(new URL("../../", import.meta.url));

function readWebSource(path: string): string {
  return readFileSync(`${webRoot}${path}`, "utf8");
}

describe("canonical scroll component", () => {
  const component = readWebSource("components/vd/scroll-area.tsx");

  it("exists at the canonical path and emits data-vd-scroll with the axis", () => {
    expect(component).toMatch(/data-vd-scroll=\{axis\}/);
    expect(component).toMatch(/export function VdScrollArea/);
  });

  it("owns overflow through the attribute, not scattered utility classes", () => {
    expect(component).not.toMatch(/overflow-y-auto|overflow-x-auto/);
  });

  it("adds no wheel scope and no scroll-event state by itself", () => {
    expect(component).not.toMatch(/data-vd-wheel-scope="local"/);
    expect(component).not.toMatch(/onScroll/);
  });

  it("has no ResizeObserver and no JS scrollbars", () => {
    expect(component).not.toMatch(/new ResizeObserver/);
    expect(component).not.toMatch(/onScroll=/);
    expect(component).not.toMatch(/\.scrollTo\(|\.scrollTop\s*=/);
  });
});

describe("core scrollers are migrated", () => {
  it("Settings content pane uses VdScrollArea", () => {
    expect(readSource("./settings-center.tsx")).toMatch(
      /<VdScrollArea\s+axis="y"\s+ref=\{settingsPaneRef\}/
    );
    // The old unstyled hook is gone.
    expect(readSource("./settings-center.tsx")).not.toMatch(/data-scrollbar/);
  });

  it("the App Appearance Inspector bodies use VdScrollArea", () => {
    expect(readSource("./app-appearance-inspector.tsx")).not.toMatch(/overflow-y-auto/);
    expect(readSource("./app-appearance-inspector.tsx")).toMatch(/<VdScrollArea/);
  });

  it("the Icon Picker grid uses VdScrollArea", () => {
    expect(readSource("./icon-picker.tsx")).toMatch(/vela-icon-picker__scroll/);
    expect(readSource("./icon-picker.tsx")).toMatch(/<VdScrollArea/);
  });

  it("the Launcher results use VdScrollArea", () => {
    expect(readSource("./launcher.tsx")).toMatch(/vela-launcher__results-scroll/);
  });

  it("the Folder overlay grid uses VdScrollArea", () => {
    expect(readSource("./folder-overlay.tsx")).toMatch(/vela-folder-overlay__scroll/);
  });

  it("the Move-to-Section dialog body uses VdScrollArea", () => {
    expect(readSource("./move-to-section-dialog.tsx")).toMatch(/<VdScrollArea/);
    expect(readSource("./move-to-section-dialog.tsx")).not.toMatch(/overflow-y-auto/);
  });

  it("the Dock owns its horizontal overflow through data-vd-scroll", () => {
    expect(readSource("./dock.tsx")).toMatch(/data-vd-scroll="x"/);
  });
});

describe("scrollbar styling stays in the token layer", () => {
  const vdUi = readWebSource("app/vd-ui.css");
  const globals = readWebSource("app/globals.css");
  const homeShell = readSource("./home-shell.css");

  it("styles scrollbars ONLY through the opted-in data-vd-scroll scope", () => {
    expect(vdUi).toMatch(/\[data-vd-ui\] \[data-vd-scroll\]::-webkit-scrollbar-thumb/);
    expect(vdUi).toMatch(/scrollbar-width:\s*thin/);
    expect(vdUi).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("has no global wildcard scrollbar styling anywhere", () => {
    for (const [name, css] of [
      ["vd-ui.css", vdUi],
      ["globals.css", globals],
      ["home-shell.css", homeShell],
    ] as const) {
      expect(css, name).not.toMatch(/\*::-webkit-scrollbar/);
      expect(css, name).not.toMatch(/html::-webkit-scrollbar/);
      expect(css, name).not.toMatch(/body::-webkit-scrollbar/);
    }
  });

  it("removed the old targeted scrollbar rules of migrated surfaces", () => {
    expect(homeShell).not.toMatch(/\.vela-rail__list::-webkit-scrollbar/);
    expect(homeShell).not.toMatch(/\.vela-launcher__results \{[^}]*overflow-y/);
    expect(homeShell).not.toMatch(/\.vela-icon-picker__grid \{[^}]*overflow-y/);
    expect(homeShell).not.toMatch(/\.vela-folder-overlay__grid \{[^}]*overflow-y/);
    // The dead move-to-section list CSS is gone entirely (rule form — a
    // comment naming the removal is fine).
    expect(homeShell).not.toMatch(/\.vela-move-section__list\s*\{/);
  });

  it("keeps the thumb quiet: muted foreground at low alpha, never pure white", () => {
    const thumb = vdUi.match(
      /\[data-vd-ui\] \[data-vd-scroll\]::-webkit-scrollbar-thumb\s*\{([\s\S]*?)\}/,
    );
    expect(thumb).not.toBeNull();
    expect(thumb![1]!).toMatch(/color-mix\(in oklab, var\(--vdu-fg-muted\)/);
    expect(thumb![1]!).not.toMatch(/#fff|white/);
  });
});

describe("scope discipline", () => {
  it("never turns the desktop root into a scroll surface", () => {
    const css = readSource("./home-shell.css");
    const desktop = css.match(/\.vela-desktop\s*\{([\s\S]*?)\}/);
    expect(desktop).not.toBeNull();
    expect(desktop![1]!).not.toMatch(/overflow(-y)?:\s*auto/);
    expect(desktop![1]!).not.toMatch(/overflow(-y)?:\s*scroll/);
  });

  it("leaves the section rail wheel navigation fully intact (019/020)", () => {
    const rail = readSource("./section-rail.tsx");
    expect(rail).toMatch(/addEventListener\(\s*["']wheel["'],\s*onWheel,\s*\{\s*passive:\s*false\s*\}\)/);
    expect(rail).toMatch(/event\.preventDefault\(\);/);
    // The inner list only receives the scroll STYLING attribute — never a
    // wheel scope that would break full-column navigation. (The rail's
    // listener CODE reads the data-vd-wheel-scope attribute off the event
    // path — that's the 017 overlay-ownership contract, not a scope here.)
    expect(rail).toMatch(/data-vd-scroll="y"/);
    expect(rail).not.toMatch(/data-vd-wheel-scope=/);
    // And the rail list keeps no native-wheel conflict: the shared layer
    // owns the scrollbar, the rail root owns the wheel.
    const css = readSource("./home-shell.css");
    expect(css).not.toMatch(/\.vela-rail__list \{[^}]*scrollbar-width:\s*none/);
  });

  it("does not reintroduce scroll-event React state on any migrated surface", () => {
    for (const file of [
      "./launcher.tsx",
      "./settings-center.tsx",
      "./app-appearance-inspector.tsx",
      "./icon-picker.tsx",
      "./folder-overlay.tsx",
      "./move-to-section-dialog.tsx",
      "./dock.tsx",
    ] as const) {
      expect(readSource(file), file).not.toMatch(/onScroll/);
    }
  });
});

describe("one canonical path per primitive", () => {
  it("deleted the superseded Task 018 primitives", () => {
    expect(existsSync(`${webRoot}components/ui/scroll-area.tsx`)).toBe(false);
    expect(existsSync(`${webRoot}components/ui/tooltip.tsx`)).toBe(false);
  });

  it("has no remaining importers of the deleted primitives", () => {
    for (const file of [
      "./launcher.tsx",
      "./settings-center.tsx",
      "./app-appearance-inspector.tsx",
      "./icon-picker.tsx",
      "./folder-overlay.tsx",
      "./move-to-section-dialog.tsx",
      "./dock.tsx",
    ] as const) {
      expect(readSource(file), file).not.toMatch(/ui\/scroll-area/);
      expect(readSource(file), file).not.toMatch(/ui\/tooltip/);
    }
  });
});
