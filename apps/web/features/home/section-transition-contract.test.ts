import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Section transition contract (task 020-A1 §32/§37, warm-layer
 * re-architecture 020-A2): the A→B section swap is a transform/opacity
 * page transition on stable, warm-mounted layers — never a layout
 * animation, never a repaint-heavy moving subtree, never a queue, never a
 * scroll-write loop riding the animation frames, and (020-A2) never a
 * destination subtree built inside the commit that starts the motion.
 */

const css = readFileSync(fileURLToPath(new URL("./home-shell.css", import.meta.url)), "utf8");

function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Anchored: a longer selector may END with the same substring (the glass
  // suspension rule wraps `.vela-app-icon[data-decoration="glass"]`), and
  // only a rule START is the real rule.
  const match = css.match(new RegExp(`^${escaped}\\s*\\{`, "m"));
  if (match === null || match.index === undefined) {
    throw new Error(`CSS rule not found: ${selector}`);
  }
  const bodyStart = css.indexOf("{", match.index) + 1;
  const bodyEnd = css.indexOf("\n}", bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

describe("section viewport geometry stays stable (020-A1 §25)", () => {
  it("the viewport is a static clip box, not a scroll or animated node", () => {
    const viewport = ruleBlock(".vela-section-viewport");
    expect(viewport).toMatch(/position:\s*relative/);
    // 019-A lineage: a clip box can never become a scroll container.
    expect(viewport).toMatch(/overflow:\s*clip/);
    expect(viewport).not.toMatch(/will-change/);
    expect(viewport).not.toMatch(/transition:/);
  });

  it("the transition layer is an absolute wrapper carrying the containment contract", () => {
    const layer = ruleBlock(".vela-section-layer");
    expect(layer).toMatch(/position:\s*absolute/);
    expect(layer).toMatch(/inset:\s*0/);
    // Scoped containment: repaint/layout invalidation stops at the wrapper
    // box. Popovers, menus and dialogs are portaled OUTSIDE this layer.
    expect(layer).toMatch(/contain:\s*layout\s+paint/);
    // 020-A2 §24: promotion is no longer permanent — a warm hidden layer
    // holds no compositor layer.
    expect(layer).not.toMatch(/will-change/);
  });

  it("only layers actually animating a transition are promoted (020-A2 §24)", () => {
    const promoted = ruleBlock('.vela-section-layer[data-transitioning="true"]');
    expect(promoted).toMatch(/will-change:\s*transform,\s*opacity/);
  });

  it("a warm hidden layer keeps layout but never paints, points or focuses", () => {
    const warm = ruleBlock('.vela-section-layer[data-warm-hidden="true"]');
    // visibility:hidden (NOT display:none — geometry must survive for the
    // ResizeObservers; NOT opacity:0 — expensive descendants would paint).
    expect(warm).toMatch(/visibility:\s*hidden/);
    expect(warm).toMatch(/pointer-events:\s*none/);
    // No display:none anywhere may hide a section layer.
    expect(css).not.toMatch(/\.vela-section-layer[^{]*\{[^}]*display:\s*none/);
  });

  it("glass tiles drop their live backdrop blur only while transitioning", () => {
    const suspension = ruleBlock(
      '.vela-section-viewport[data-section-transitioning="true"] .vela-app-icon[data-decoration="glass"]'
    );
    expect(suspension).toMatch(/backdrop-filter:\s*none/);
    // Scoped to the transition window: the unscoped glass rule keeps blur.
    const glass = ruleBlock('.vela-app-icon[data-decoration="glass"]');
    expect(glass).toMatch(/backdrop-filter:\s*blur\(/);
  });
});

describe("the page transition animates the wrapper transform only (020-A1 §23, 022)", () => {
  const coordinator = readSource("./section-pair-animator.ts");

  it("the coordinator animates y only — never layout properties, never an opacity crossfade", () => {
    // The 022 choreography slides pages at opacity 1; the visible regions
    // meet at a moving boundary, so opacity must never be animated.
    expect(coordinator).toMatch(/\by: 0\b/);
    expect(coordinator).toMatch(/y: exitY/);
    expect(coordinator).toMatch(/y: entryY/);
    expect(coordinator).not.toMatch(/\bopacity:\s*0/);
    const forbidden = [/\btop:/, /\bleft:/, /\bright:/, /\bbottom:/, /\bwidth:/, /\bheight:/, /\bmargin/, /\bpadding/];
    for (const pattern of forbidden) {
      expect(coordinator, `the pair coordinator must not animate ${pattern}`).not.toMatch(pattern);
    }
  });

  it("the resting pose goes through the same GSAP owner, targeted (never clearProps:all)", () => {
    expect(coordinator).toMatch(/gsap\.set\(element, \{ y: 0, opacity: 1 \}\)/);
    expect(coordinator).not.toMatch(/clearProps:\s*"all"/);
  });

  it("the transform lives on the page wrapper only (dnd-kit hard-snap contract)", () => {
    // .vela-item must never gain a page-level transform/transition.
    const cssItem = ruleBlock(".vela-item");
    expect(cssItem).not.toMatch(/transition:[^;]*transform/);
  });
});

describe("scroll restoration stays off the animation frames (020-A1 §28)", () => {
  const sectionView = readSource("./section-view.tsx");

  it("re-applies on real content resizes, never on a polling interval", () => {
    expect(sectionView).toMatch(/ResizeObserver/);
    expect(sectionView).not.toMatch(/setInterval/);
  });

  it("the observer disconnects once satisfied and on unmount", () => {
    expect(sectionView).toMatch(/disconnect\(\)/);
  });

  it("a warm page keeps its live scroll; only a mount restores (020-A2 §30)", () => {
    // The restore effect is mount-only and never reads the layer phase or
    // the active flag: a hidden→entering flip must not rewrite scrollTop.
    const restore = sectionView.slice(
      sectionView.indexOf("Restore the remembered scroll position"),
      sectionView.indexOf("eslint-disable-next-line react-hooks/exhaustive-deps")
    );
    expect(restore).toMatch(/ONCE PER MOUNT/);
    expect(restore).not.toMatch(/\bactive\b/);
    expect(restore).not.toMatch(/\bphase\b/);
  });
});

describe("the rail marker is GSAP-placed and never stretched by CSS (022-R2)", () => {
  it("the stylesheet fallback HIDES the marker — no percent box, no opposing constraint", () => {
    const rule = ruleBlock(".vela-rail__indicator");
    // Hidden until GSAP places it: the pre-022-R2 fallback (top: 20%;
    // height: 60% of the LIST) painted the marker across several rows
    // whenever inline geometry was absent (first entry / re-entry).
    expect(rule).toMatch(/opacity:\s*0/);
    expect(rule).not.toMatch(/top:/);
    expect(rule).not.toMatch(/height:/);
    // GSAP animates top/height — no bottom/inset constraint may fight it.
    expect(rule).not.toMatch(/bottom:/);
    expect(rule).not.toMatch(/inset-block-end:/);
  });

  it("the indicator measures the selected ROW in the container's coordinate space", () => {
    const indicator = readSource("../../components/vd/animated-indicator.tsx");
    // Direct row measurement, one verified coordinate space, geometry
    // re-validation without timers, and hidden before a valid box exists.
    expect(indicator).toMatch(/offsetTop/);
    expect(indicator).toMatch(/offsetParent/);
    expect(indicator).toMatch(/ResizeObserver/);
    expect(indicator).not.toMatch(/setInterval/);
    expect(indicator).not.toMatch(/setTimeout/);
    // First placement is a set — the sweep-free first position.
    expect(indicator).toMatch(/!placedRef\.current \|\| !activationChanged/);
  });
});

describe("the transition lifecycle is machine-owned (020-A2)", () => {
  const shell = readSource("./desktop-shell.tsx");
  const machine = readSource("./section-transition-machine.ts");

  it("publishes the transitioning flag for the whole machine gesture", () => {
    expect(shell).toMatch(/data-section-transitioning=/);
    expect(shell).toMatch(/sectionNavMachine\.kind !== "idle"/);
  });

  it("no AnimatePresence and no presence nonce remains (020-A2 §21)", () => {
    // Remounting a presence subtree to restart an animation destroys and
    // recreates the page's whole component tree — the machine's pose model
    // replaces it.
    expect(shell).not.toMatch(/AnimatePresence/);
    expect(shell).not.toMatch(/sectionPresenceNonce/);
    expect(shell).not.toMatch(/PresenceNonce/);
  });

  it("a page's React key is the stable page id — never id + nonce (020-A2 §28)", () => {
    // The layer map keys each section by page.id alone; motion state lives
    // in the machine, never in the key.
    expect(shell).toMatch(/key=\{page\.id\}/);
    expect(shell).not.toMatch(/key=\{[^}]*nonce/i);
    expect(shell).not.toMatch(/key=\{[^}]*direction/);
    expect(shell).not.toMatch(/key=\{[^}]*counter/i);
  });

  it("a warm switch request never changes the mounted set (020-A2 §29)", () => {
    // The central regression contract lives in the PURE machine: the warm
    // branch of requestSection returns the mounted set untouched, and the
    // pure test asserts reference identity.
    expect(machine).toMatch(/THE MOUNTED SET NEVER CHANGES/);
  });

  it("a cold destination mounts hidden first, then reveals (020-A2 §16)", () => {
    // The machine models the prepared (hidden) state; the shell arms it
    // from a lifecycle effect — the preparation frame is painted, and the
    // reveal never shares a commit with the mount.
    expect(machine).toMatch(/kind: "prepared"/);
    expect(shell).toMatch(/armPreparedSection/);
  });

  it("the pure machine owns idle/prepared/transition — no queues, no timers", () => {
    expect(machine).toMatch(/"idle"/);
    expect(machine).toMatch(/"prepared"/);
    expect(machine).toMatch(/"transition"/);
    expect(machine).not.toMatch(/setTimeout|setInterval/);
    const shellSwitch = shell.slice(
      shell.indexOf("const switchSection"),
      shell.indexOf("const switchSection") + 4200
    );
    expect(shellSwitch).not.toMatch(/setTimeout|setInterval/);
  });
});
