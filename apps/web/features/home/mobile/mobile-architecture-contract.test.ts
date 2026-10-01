import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Task 026 §29/§62/§81/§88 — static architecture contracts, checked against
 * the real sources (no rendering): the mobile shell's import graph stays
 * free of every desktop editing dependency; the entry code-splits BOTH
 * shells; and the mobile stylesheet carries the safe-area/dvh/touch/16px
 * geometry. Source-level checks prove the boundary cheaply; runtime
 * behavior is covered by the component suites.
 */

const mobileDir = fileURLToPath(new URL("./", import.meta.url));
const homeDir = fileURLToPath(new URL("../", import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(`${mobileDir}${relativePath}`, "utf8");
}

function readHomeSource(relativePath: string): string {
  return readFileSync(`${homeDir}${relativePath}`, "utf8");
}

const MOBILE_MODULE_NAMES = [
  "mobile-shell.tsx",
  "mobile-header.tsx",
  "mobile-category-tabs.tsx",
  "mobile-app-grid.tsx",
  "mobile-dock.tsx",
  "mobile-search.tsx",
  "mobile-folder-sheet.tsx",
  "mobile-menu-sheet.tsx",
  "mobile-sheet.tsx",
  "mobile-section-items.ts",
] as const;

function mobileModules(): readonly { readonly name: string; readonly source: string }[] {
  return MOBILE_MODULE_NAMES.map((name) => ({ name, source: readSource(name) }));
}

/** Banned direct imports: the desktop authoring machinery (§29/§64). */
const BANNED_IMPORT_PATTERNS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /["']\.\.\/desktop-shell(\.tsx)?["']/, why: "DesktopShell itself" },
  { pattern: /["']\.\.\/\.\.\/desktop-grid\//, why: "desktop-grid DnD helpers" },
  { pattern: /["']\.\.\/\.\.\/canvas\//, why: "canvas drag/resize/handoff/history" },
  { pattern: /["']\.\.\/arrange-toolbar["']/, why: "arrange toolbar" },
  { pattern: /["']\.\.\/context-menu["']/, why: "desktop context menu" },
  { pattern: /["']\.\.\/desktop-command-menu["']/, why: "desktop command menu" },
  { pattern: /["']\.\.\/(add-app-dialog|edit-app-dialog|section-dialog|folder-dialog|move-to-section-dialog|confirm-dialog)["']/, why: "management dialogs" },
  { pattern: /["']\.\.\/settings-center["']/, why: "desktop Settings Center" },
  { pattern: /["']\.\.\/app-appearance-inspector["']/, why: "desktop App Inspector" },
  { pattern: /["']\.\.\/\.\.\/import-json\//, why: "JSON Import" },
  { pattern: /@dnd-kit\//, why: "dnd-kit" },
  { pattern: /["']\.\.\/dnd-static-drop["']/, why: "DnD drop-animation wiring" },
  { pattern: /["']\.\.\/selection-state["']|["']\.\.\/selection-geometry["']/, why: "marquee/selection" },
  { pattern: /["']\.\.\/section-transition-machine["']|["']\.\.\/section-pair-animator["']/, why: "the desktop transition machine (§18)" },
];

describe("mobile dependency boundary (§29/§64/§88)", () => {
  it("no mobile module imports ANY desktop editing/authoring dependency", () => {
    for (const unit of mobileModules()) {
      for (const banned of BANNED_IMPORT_PATTERNS) {
        expect(
          banned.pattern.test(unit.source),
          `${unit.name} must not import ${banned.why}`,
        ).toBe(false);
      }
    }
  });

  it("the mobile shell reuses the SHARED consumption modules (not copies)", () => {
    const shell = readSource("mobile-shell.tsx");
    expect(shell).toContain("resolveEffectiveWallpaper"); // 023-C resolver
    expect(shell).toContain("launch-app"); // canonical open helper
    const search = readSource("mobile-search.tsx");
    expect(search).toContain("buildLauncherEntries"); // shared index
    expect(search).toContain("searchLauncherEntries"); // shared ranking
    expect(search).toContain("includeCommands: false"); // consumption-only
    expect(search).toContain("moveLauncherIndex"); // shared keyboard model
  });

  it("no mobile module duplicates the search model (§35)", () => {
    for (const unit of mobileModules()) {
      expect(unit.source, `${unit.name} must not reimplement search`).not.toMatch(
        /function (scoreToken|tokenizeQuery|searchEntries)/,
      );
    }
  });
});

describe("shell code splitting (§62/§63)", () => {
  it("the home entry no longer statically imports DesktopShell — both shells load lazily behind the resolver", () => {
    const velaHome = readHomeSource("vela-home.tsx");
    expect(velaHome).not.toMatch(/import \{[^}]*DesktopShell[^}]*\} from "\.\/desktop-shell"/);
    const responsive = readHomeSource("responsive-workspace-shell.tsx");
    expect(responsive).toContain('import("./desktop-shell")');
    expect(responsive).toContain('import("./mobile/mobile-shell")');
    expect(responsive).toContain("lazy(");
    // The startup surface is the chunk-load fallback — never a blank screen.
    expect(responsive).toContain("StartupScreen");
  });

  it("the shared runtime stays ABOVE the shell switch (§4)", () => {
    const velaHome = readHomeSource("vela-home.tsx");
    const providerIndex = velaHome.indexOf("WorkspaceRuntimeProvider");
    const shellIndex = velaHome.indexOf("ResponsiveWorkspaceShell");
    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(shellIndex).toBeGreaterThanOrEqual(0);
    expect(providerIndex).toBeLessThan(shellIndex);
  });
});

describe("category active state (R1 §5–§9/§51)", () => {
  const css = readSource("mobile-shell.css");

  /** One CSS rule block for a (single-line) selector, or throws. */
  function ruleBlock(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
    if (match === null) {
      throw new Error(`CSS rule not found: ${selector}`);
    }
    return match[1]!;
  }

  it("the tablist is its own positioned container — the shared indicator can actually place (R1 root cause)", () => {
    // VdAnimatedIndicator places only when the tab's offsetParent IS the
    // indicator's container; without this the marker stayed opacity:0 and
    // the active category was identifiable only by faint text.
    expect(ruleBlock(".vela-mobile-tabs__list")).toMatch(/position:\s*relative/);
  });

  it("active tab: primary foreground + clearly heavier weight", () => {
    const active = ruleBlock('.vela-mobile-tabs__tab[aria-selected="true"]');
    expect(active).toMatch(/color:\s*var\(--vd-text\)/);
    expect(active).toMatch(/font-weight:\s*650/);
  });

  it("inactive tab: ~70% foreground mix — readable, never a disabled token (§40)", () => {
    const inactive = ruleBlock(".vela-mobile-tabs__tab");
    expect(inactive).toMatch(/color-mix\(in oklab, var\(--vd-text\) 70%, transparent\)/);
    expect(inactive).toMatch(/font-weight:\s*500/);
    // No disabled-token color and no disabled-level opacity.
    expect(inactive).not.toMatch(/--vdu-fg-disabled|--vd-text-disabled/);
    expect(inactive).not.toMatch(/opacity:\s*0\.[34]/);
  });

  it("ONE active marker owner: the shared indicator pill, accent-derived (§7)", () => {
    const indicator = ruleBlock(".vela-mobile-tabs__indicator");
    expect(indicator).toMatch(/border-radius:\s*999px/);
    expect(indicator).toMatch(/var\(--vd-accent/);
    // No second indicator/underline owner rides the tabs themselves.
    expect(css).not.toMatch(/\.vela-mobile-tabs__tab::(after|before)/);
    expect(css.match(/vela-mobile-tabs__indicator/g)?.length ?? 0).toBeLessThanOrEqual(3);
  });
});

describe("mobile typography & app labels (R1 §10–§15/§49)", () => {
  const css = readSource("mobile-shell.css");

  function ruleBlockOf(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
    if (match === null) {
      throw new Error(`CSS rule not found: ${selector}`);
    }
    return match[1]!;
  }

  it("app labels: 14px/18px in the normal text color — never placeholder-level (§13)", () => {
    const label = ruleBlockOf(".vela-mobile-tile__label");
    expect(label).toMatch(/font-size:\s*14px/);
    expect(label).toMatch(/line-height:\s*18px/);
    expect(label).toMatch(/color:\s*var\(--vd-text\)/);
    expect(label).not.toMatch(/disabled|placeholder/);
  });

  it("app labels clamp to TWO lines with a uniform two-line block height (§14/§15)", () => {
    const label = ruleBlockOf(".vela-mobile-tile__label");
    expect(label).toMatch(/display:\s*-webkit-box/);
    expect(label).toMatch(/-webkit-box-orient:\s*vertical/);
    expect(label).toMatch(/-webkit-line-clamp:\s*2/);
    expect(label).toMatch(/overflow:\s*hidden/);
    // The label area holds exactly two lines so short and long names keep
    // one grid rhythm.
    expect(label).toMatch(/min-height:\s*36px/);
    // The single-line ellipsis rule is gone — wrapping replaces it.
    expect(label).not.toMatch(/white-space:\s*nowrap/);
  });

  it("the mobile hint is muted but readable, multi-line capable (§30)", () => {
    const hint = ruleBlockOf(".vela-mobile-menu__hint");
    expect(hint).toMatch(/font-size:\s*13px/);
    expect(hint).toMatch(/line-height:\s*1\.45/);
    expect(hint).toMatch(/var\(--vdu-fg-muted/);
    expect(hint).not.toMatch(/font-weight:\s*300/);
  });
});

describe("menu vs folder sheet sizing (R1 §17–§20/§46)", () => {
  const css = readSource("mobile-shell.css");

  function ruleBlocksOf(selector: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = css.matchAll(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "gm"));
    const blocks = Array.from(matches, (match) => match[1]!);
    if (blocks.length === 0) {
      throw new Error(`CSS rule not found: ${selector}`);
    }
    return blocks;
  }

  it("the MENU surface is content-sized with a capped max — never a fixed tall block", () => {
    const menu = ruleBlocksOf(".vela-mobile-sheet__surface--menu").join("\n");
    expect(menu).toMatch(/max-block-size:\s*min\(70dvh, 520px\)/);
    expect(menu).not.toMatch(/(^|\s)(height|min-block-size|block-size):/);
    expect(menu).not.toContain("82dvh");
  });

  it("the FOLDER surface keeps its own tall policy (unchanged by the menu diet)", () => {
    const folder = ruleBlocksOf(".vela-mobile-sheet__surface--folder").join("\n");
    expect(folder).toMatch(/max-height:\s*min\(82dvh, 640px\)/);
  });

  it("menu and folder share no forced common height class (§45C)", () => {
    // The two surface modifiers are the only sizing owners; the shared
    // bottom HOST positions but never sizes the surface block.
    const host = ruleBlocksOf(".vela-mobile-sheet--bottom-host").join("\n");
    expect(host).not.toMatch(/(^|\s)(height|max-height|min-height|block-size):/);
  });
});

describe("sheet readability & layering (R1 §21–§25/§47/§48)", () => {
  const css = readSource("mobile-shell.css");

  function ruleBlocksOf(selector: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = css.matchAll(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "gm"));
    const blocks = Array.from(matches, (match) => match[1]!);
    if (blocks.length === 0) {
      throw new Error(`CSS rule not found: ${selector}`);
    }
    return blocks;
  }

  it("sheet surfaces ride the CANONICAL floored overlay token — no raw colors (§21/§22/§47)", () => {
    const surfaces = [
      ...ruleBlocksOf(".vela-mobile-sheet__surface--menu"),
      ...ruleBlocksOf(".vela-mobile-sheet__surface--folder"),
      ...ruleBlocksOf(".vela-mobile-sheet__surface--fullscreen"),
    ].join("\n");
    // The existing --vdu-overlay already carries the 0.96 readability floor
    // (021-R1) — the mobile sheets consume it instead of the translucent
    // --vdu-window, so Clean/Soft/Glass all stay readable (§53).
    expect(surfaces).toMatch(/background:\s*var\(--vdu-overlay\)/);
    expect(surfaces).not.toContain("--vdu-window");
    expect(surfaces).not.toMatch(/rgba\(/);
    expect(surfaces).not.toMatch(/background:[^;]*oklch\(/);
  });

  it("the layer order is explicit: scrim & sheets sit ABOVE the dock (§24/§48)", () => {
    const dock = ruleBlocksOf(".vela-mobile-dock").join("\n");
    const scrim = ruleBlocksOf(".vela-mobile-sheet__scrim").join("\n");
    const hosts = [
      ...ruleBlocksOf(".vela-mobile-sheet--bottom-host"),
      ...ruleBlocksOf(".vela-mobile-sheet--fullscreen-host"),
    ].join("\n");
    const zIndex = (block: string): number =>
      Number(block.match(/z-index:\s*(\d+)/)?.[1] ?? NaN);
    expect(zIndex(dock)).toBe(2);
    expect(zIndex(scrim)).toBe(50);
    expect(zIndex(hosts)).toBe(50);
    expect(zIndex(hosts)).toBeGreaterThan(zIndex(dock));
  });

  it("ONE scrim owner — the shared GSAP overlay behind every sheet (§23)", () => {
    // Exactly one scrim rule, no second backdrop layer anywhere.
    expect(ruleBlocksOf(".vela-mobile-sheet__scrim")).toHaveLength(1);
    expect(css).not.toMatch(/vela-mobile-[a-z-]*backdrop/);
  });
});

describe("animation ownership source contracts (R2 §23/§24/§32)", () => {
  const mobileShellSource = readHomeSource("mobile/mobile-shell.tsx");
  const indicatorSource = readHomeSource("../../components/vd/animated-indicator.tsx");
  const wallpaperSource = readHomeSource("desktop-wallpaper.tsx");
  const css = readSource("mobile-shell.css");

  it("the section pane tween only ever animates transform x + opacity", () => {
    // Every gsap tween call site in the mobile shell must keep to the
    // compositor properties — layout/margin keys are forbidden outright.
    const tweenCalls = mobileShellSource.match(/gsap\.(?:to|fromTo)\(/g) ?? [];
    expect(tweenCalls.length).toBeGreaterThanOrEqual(1);
    expect(mobileShellSource).not.toMatch(
      /gsap\.(?:to|fromTo)\([^;]*?(?:width|height|top|left|margin|padding):/,
    );
    // The entrance is the canonical short settle.
    expect(mobileShellSource).toContain("{ x: 12, opacity: 0 }");
  });

  it("the wallpaper crossfade animates opacity ONLY", () => {
    expect(wallpaperSource).toMatch(/gsap\.fromTo\(\s*incomingRef\.current,\s*\{\s*opacity: 0\s*\},/);
    expect(wallpaperSource).not.toMatch(
      /gsap\.(?:to|fromTo)\([^;]*?(?:width|height|filter|background-position|background-size|backdrop-filter):/,
    );
  });

  it("the horizontal indicator moves via transform — width is SET, never tweened", () => {
    // The horizontal branch's tween destination is x + opacity only.
    expect(indicatorSource).toContain("{ x: target.offsetLeft, opacity: 1 }");
    // No gsap tween call in the shared indicator animates layout keys.
    expect(indicatorSource).not.toMatch(
      /gsap\.to\(\s*element,\s*\{[^}]*?(?:left|top|width|height):/,
    );
    // Width is part of the rest geometry: exactly the set path.
    expect(indicatorSource).toMatch(/gsap\.set\(element, \{ width: target\.offsetWidth \}\)/);
    // The desktop rail default is unchanged.
    expect(indicatorSource).toContain('axis = "vertical"');
  });

  it("will-change exists ONLY on the entering pane — no blanket hints (§24)", () => {
    const uses = css.match(/will-change:[^;]+;/g) ?? [];
    expect(uses).toEqual(["will-change: transform, opacity;"]);
    expect(css).not.toMatch(/will-change:[^;]*\*/);
    expect(css).not.toMatch(/\*\s*\{[^}]*will-change/);
  });
});

describe("mobile stylesheet geometry contracts (§53/§54/§55/§81)", () => {
  const css = readSource("mobile-shell.css");

  it("safe-area insets on the header, dock and fullscreen surfaces", () => {
    const safeAreaUses = css.match(/env\(safe-area-inset-(top|bottom|left|right)/g) ?? [];
    expect(safeAreaUses.length).toBeGreaterThanOrEqual(4);
    expect(css).toMatch(/\.vela-mobile-header[\s\S]{0,400}safe-area-inset-top/);
    expect(css).toMatch(/\.vela-mobile-dock[\s\S]{0,600}safe-area-inset-bottom/);
    expect(css).toMatch(/safe-area-inset-left/);
    expect(css).toMatch(/safe-area-inset-right/);
  });

  it("dynamic-viewport height with a vh fallback (§54)", () => {
    expect(css).toMatch(/height: 100vh;/);
    expect(css).toMatch(/height: 100dvh;/);
  });

  it("the root clips horizontal overflow; only tabs/dock scroll sideways (§55)", () => {
    expect(css).toMatch(/\.vela-mobile-shell \{[\s\S]{0,600}overflow-x: clip/);
    expect(css).toMatch(/\.vela-mobile-tabs__list[\s\S]{0,800}overflow-x: auto/);
    expect(css).toMatch(/\.vela-mobile-dock__track[\s\S]{0,600}overflow-x: auto/);
    // No body-level overflow rule is (re)introduced — the clip is scoped to
    // the mobile root only.
    expect(css).not.toMatch(/(^|[^_\w-])body\s*\{[^}]*overflow/);
  });

  it("touch behavior: manipulation on interactive targets, no global touch-action:none (§56)", () => {
    expect(css.match(/touch-action: manipulation/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(css).not.toContain("touch-action: none");
  });

  it("search input is 16px (no iOS auto-zoom, §36) and rows are ≥52px (§37)", () => {
    expect(css).toMatch(/\.vela-mobile-search__input[\s\S]{0,300}font-size: 16px/);
    expect(css).toMatch(/\.vela-mobile-search__row[\s\S]{0,400}min-height: 52px/);
  });

  it("44px minimum touch targets on icon buttons and tabs (§83)", () => {
    expect(css).toMatch(/\.vela-mobile-icon-button[\s\S]{0,300}width: 44px/);
    expect(css).toMatch(/min-height: 44px/);
  });

  it("desktop core rules are never touched — vela-mobile-* namespace only (§84)", () => {
    expect(css).toMatch(/^\s*\.vela-/m);
    for (const line of css.split("\n")) {
      const selectorLine = line.trim().startsWith(".") ? line : null;
      if (selectorLine !== null && /vela-/.test(selectorLine)) {
        // Every class selector in the mobile stylesheet is mobile-scoped.
        expect(selectorLine).toMatch(/vela-mobile/);
      }
    }
  });

  it("reduced-motion rules exist for the mobile namespace (§61)", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*vela-mobile/);
  });
});
