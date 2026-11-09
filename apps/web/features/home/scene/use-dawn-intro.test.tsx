// @vitest-environment jsdom
/*
 * The Dawn opening's gate logic (P1, motion-spec-p1 §2): once per tab
 * session, never within the 5s quiet window, never on a bfcache restore —
 * and the hook itself touches nothing over a custom wallpaper (`enabled`
 * false) or under reduced motion. Dawn is on by default — not behind the
 * helmMotion experiment switch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { RefObject } from "react";

import { StrictMode } from "react";

import { gsap } from "@components/vd/gsap";
import {
  claimDawnOpening,
  collectIntroTiles,
  completeDawnOpening,
  hasDawnOpeningPlayed,
  isDawnRevealTarget,
  releaseDawnOpening,
  resetDawnOpeningSessionForTests,
  useDawnIntro,
} from "./use-dawn-intro";

function mountIntro(
  enabled: boolean,
  reducedMotion: boolean,
): { band: HTMLElement; veil: HTMLElement } {
  installMatchMedia(reducedMotion);
  const band = document.createElement("div");
  const veil = document.createElement("div");
  const scope = document.createElement("div");
  scope.append(band, veil);
  document.body.append(scope);
  const bandRef = { current: band } as RefObject<HTMLDivElement | null>;
  const veilRef = { current: veil } as RefObject<HTMLDivElement | null>;
  const scopeRef = { current: scope } as RefObject<HTMLElement | null>;
  function Host() {
    useDawnIntro({ enabled, scope: scopeRef, band: bandRef, veil: veilRef });
    return null;
  }
  render(<Host />);
  return { band, veil };
}

function installMatchMedia(reducedMotion: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reducedMotion && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  resetDawnOpeningSessionForTests();
});

describe("Dawn session gate (claim → complete | release)", () => {
  it("a completed claim counts as played: later claims are refused", () => {
    const claim = claimDawnOpening("navigate");
    expect(claim).not.toBeNull();
    completeDawnOpening(claim!);
    expect(hasDawnOpeningPlayed()).toBe(true);
    // A rapid remount or a later reopen never replays it.
    expect(claimDawnOpening("navigate")).toBeNull();
  });

  it("a held claim refuses a second, concurrent mount", () => {
    const first = claimDawnOpening("navigate");
    expect(first).not.toBeNull();
    expect(claimDawnOpening("navigate")).toBeNull();
    releaseDawnOpening(first!);
  });

  it("a released (killed) claim is NOT played: the next mount may play", () => {
    const killed = claimDawnOpening("navigate");
    releaseDawnOpening(killed!);
    expect(hasDawnOpeningPlayed()).toBe(false);
    const next = claimDawnOpening("navigate");
    expect(next).not.toBeNull();
    completeDawnOpening(next!);
    expect(hasDawnOpeningPlayed()).toBe(true);
  });

  it("a stale release after completion never un-plays it", () => {
    const claim = claimDawnOpening("navigate")!;
    completeDawnOpening(claim);
    releaseDawnOpening(claim);
    expect(hasDawnOpeningPlayed()).toBe(true);
    expect(claimDawnOpening("navigate")).toBeNull();
  });

  it("never plays on a bfcache restore, and the refusal writes nothing", () => {
    expect(claimDawnOpening("back_forward")).toBeNull();
    expect(hasDawnOpeningPlayed()).toBe(false);
    expect(claimDawnOpening("navigate")).not.toBeNull();
  });
});

describe("useDawnIntro gating", () => {
  it("never writes inline styles when the scene is not a preset (custom wallpaper)", () => {
    const { band, veil } = mountIntro(false, false);
    expect(band.style.length).toBe(0);
    expect(veil.style.length).toBe(0);
  });

  it("never writes inline styles under reduced motion", () => {
    const { band, veil } = mountIntro(true, true);
    expect(band.style.length).toBe(0);
    expect(veil.style.length).toBe(0);
  });

  it("drives the overlay nodes over a preset scene when motion is allowed", async () => {
    // The timeline's first fromTo applies the band's starting transform on
    // its first tick (GSAP renders tween start values once the playhead
    // enters them), proving the moment actually armed.
    const { band } = mountIntro(true, false);
    await waitFor(() => {
      expect(band.style.transform).not.toBe("");
    });
  });
});

/** A shell root hosting the scene layer plus two tile bodies (like the desktop). */
function mountShellWithTiles(options: { readonly strict?: boolean; readonly reducedMotion?: boolean } = {}) {
  installMatchMedia(options.reducedMotion ?? false);
  // jsdom renders no boxes: report one client rect so tiles count as rendered.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const root = document.createElement("div");
  root.className = "vela-desktop";
  const scene = document.createElement("div");
  scene.className = "vela-desktop__scene";
  const band = document.createElement("div");
  const veil = document.createElement("div");
  scene.append(band);
  const workbench = document.createElement("div");
  const tileA = document.createElement("span");
  tileA.className = "vela-item__body";
  const tileB = document.createElement("span");
  tileB.className = "vela-item__body";
  const hidden = document.createElement("div");
  hidden.setAttribute("aria-hidden", "true");
  const hiddenTile = document.createElement("span");
  hiddenTile.className = "vela-item__body";
  hidden.append(hiddenTile);
  workbench.append(tileA, tileB, hidden);
  root.append(scene, workbench, veil);
  document.body.append(root);
  const scopeRef = { current: scene } as RefObject<HTMLElement | null>;
  const bandRef = { current: band } as RefObject<HTMLDivElement | null>;
  const veilRef = { current: veil } as RefObject<HTMLDivElement | null>;
  function Host() {
    useDawnIntro({ enabled: true, scope: scopeRef, band: bandRef, veil: veilRef });
    return null;
  }
  const view = render(options.strict === true ? <StrictMode><Host /></StrictMode> : <Host />);
  return { view, scene, band, veil, tiles: [tileA, tileB], hiddenTile };
}

describe("useDawnIntro tile reveal (shell-root scope)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    gsap.globalTimeline.clear();
  });

  it("finds the tiles in the SHELL ROOT, not inside the scene layer", () => {
    const { scene, tiles, hiddenTile } = mountShellWithTiles({ reducedMotion: true });
    const found = collectIntroTiles(scene);
    expect(found).toHaveLength(2);
    expect(found).toEqual(expect.arrayContaining(tiles));
    expect(found).not.toContain(hiddenTile);
  });

  it("drives every tile body with the timeline (hidden at start, owned while revealing)", () => {
    const { tiles, hiddenTile } = mountShellWithTiles();
    for (const tile of tiles) {
      // immediateRender: the reveal's start state is on the tile at once.
      expect(tile.style.opacity).toBe("0");
      expect(tile.style.transform).not.toBe("");
      expect(isDawnRevealTarget(tile)).toBe(true);
      expect(gsap.getTweensOf(tile).length).toBeGreaterThan(0);
    }
    expect(hiddenTile.style.length).toBe(0);
  });

  it("an input jump settles everything and clears the tiles' inline styles (counts as played)", () => {
    const { tiles, band, veil } = mountShellWithTiles();
    window.dispatchEvent(new Event("pointerdown"));
    for (const element of [...tiles, band, veil]) {
      expect(element.style.opacity).toBe("");
      expect(element.style.transform).toBe("");
    }
    for (const tile of tiles) {
      expect(isDawnRevealTarget(tile)).toBe(false);
    }
    expect(hasDawnOpeningPlayed()).toBe(true);
  });

  it("an unmount mid-play leaves no tile hidden and does NOT count as played", () => {
    const { view, tiles } = mountShellWithTiles();
    view.unmount();
    for (const tile of tiles) {
      expect(tile.style.opacity).toBe("");
      expect(tile.style.transform).toBe("");
      expect(isDawnRevealTarget(tile)).toBe(false);
    }
    expect(hasDawnOpeningPlayed()).toBe(false);
  });

  it("reduced motion settles statically and counts as played", () => {
    const { tiles } = mountShellWithTiles({ reducedMotion: true });
    for (const tile of tiles) {
      expect(tile.style.length).toBe(0);
    }
    expect(hasDawnOpeningPlayed()).toBe(true);
  });
});

describe("useDawnIntro under React.StrictMode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    gsap.globalTimeline.clear();
  });

  it("still plays (the simulated unmount releases, the remount plays) — exactly once", async () => {
    const { band, tiles } = mountShellWithTiles({ strict: true });
    // The surviving mount drives the band and the tiles.
    expect(band.style.transform).not.toBe("");
    expect(tiles[0]!.style.opacity).toBe("0");
    // Exactly ONE live opening timeline (the killed StrictMode one is gone).
    const live = gsap.globalTimeline
      .getChildren(false, false, true)
      .filter((timeline) => (timeline as gsap.core.Timeline).getChildren(false, true, false).some((tween) => tween.targets().includes(band)));
    expect(live).toHaveLength(1);
    // It completes as played, and nothing replays afterwards.
    window.dispatchEvent(new Event("keydown"));
    expect(hasDawnOpeningPlayed()).toBe(true);
    expect(claimDawnOpening("navigate")).toBeNull();
    await waitFor(() => {
      expect(band.style.transform).toBe("");
    });
  });
});
