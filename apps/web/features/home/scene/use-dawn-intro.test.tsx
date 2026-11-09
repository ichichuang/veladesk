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

import { resetDawnOpeningSessionForTests, shouldPlayDawnOpening, useDawnIntro } from "./use-dawn-intro";

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

describe("shouldPlayDawnOpening (session gate)", () => {
  it("plays on a cold open, then never again in the same session", () => {
    resetDawnOpeningSessionForTests();
    expect(shouldPlayDawnOpening(1_000, "navigate")).toBe(true);
    // A rapid remount (StrictMode, a workspace round-trip) is refused.
    expect(shouldPlayDawnOpening(2_000, "navigate")).toBe(false);
    // The moment is once per tab session — a later reopen never replays it.
    expect(shouldPlayDawnOpening(60_000, "navigate")).toBe(false);
  });

  it("never plays on a bfcache restore", () => {
    resetDawnOpeningSessionForTests();
    expect(shouldPlayDawnOpening(1_000, "back_forward")).toBe(false);
    // The refused play wrote no stamp: a later cold open still plays.
    expect(shouldPlayDawnOpening(1_100, "navigate")).toBe(true);
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
