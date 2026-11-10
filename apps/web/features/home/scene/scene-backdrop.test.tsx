// @vitest-environment jsdom
/*
 * The scene backdrop's Dawn gate (P1, motion-spec-p1 §2): Dawn is ON BY
 * DEFAULT — no helmMotion switch is consulted — over a PRESET scene; a
 * custom image wallpaper keeps the static horizon and never plays the opening;
 * reduced motion renders the static final state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import type { EffectiveWallpaper } from "@veladesk/domain";

import { SceneBackdrop } from "./scene-backdrop";
import { resetDawnOpeningSessionForTests } from "./use-dawn-intro";

const PRESET: EffectiveWallpaper = {
  config: { kind: "preset", presetId: "dawn" },
  provenance: "default",
};

const CUSTOM: EffectiveWallpaper = {
  config: { kind: "asset", assetId: "asset-1", fit: "cover", position: "center" },
  provenance: "workspace",
};

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
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  resetDawnOpeningSessionForTests();
});

describe("SceneBackdrop Dawn gate", () => {
  it("plays the opening by default over a preset scene (no experiment switch)", async () => {
    installMatchMedia(false);
    const { container } = render(<SceneBackdrop wallpaper={PRESET} assetUrl={null} />);
    const band = container.querySelector<HTMLElement>(".vela-dawn-horizon__band");
    expect(band).not.toBeNull();
    await waitFor(() => {
      expect(band!.style.transform).not.toBe("");
    });
  });

  it("never plays over a custom image wallpaper", () => {
    installMatchMedia(false);
    const { container } = render(
      <SceneBackdrop wallpaper={CUSTOM} assetUrl="blob:fake" />,
    );
    expect(container.querySelector(".vela-dawn-horizon")).not.toBeNull();
    expect(container.querySelector<HTMLElement>(".vela-dawn-horizon__band")!.style.length).toBe(0);
    const veil = container.querySelector<HTMLElement>(".vela-dawn-veil");
    expect(veil).not.toBeNull();
    expect(veil!.style.length).toBe(0);
  });

  it("renders the static final state under reduced motion", () => {
    installMatchMedia(true);
    const { container } = render(<SceneBackdrop wallpaper={PRESET} assetUrl={null} />);
    const band = container.querySelector<HTMLElement>(".vela-dawn-horizon__band");
    const veil = container.querySelector<HTMLElement>(".vela-dawn-veil");
    expect(band!.style.length).toBe(0);
    expect(veil!.style.length).toBe(0);
  });

  it("can still be forced static by the caller", () => {
    installMatchMedia(false);
    const { container } = render(
      <SceneBackdrop wallpaper={PRESET} assetUrl={null} dawnIntroEnabled={false} />,
    );
    const veil = container.querySelector<HTMLElement>(".vela-dawn-veil");
    expect(veil!.style.length).toBe(0);
  });
});

describe("SceneBackdrop once per tab across shells", () => {
  it("a desktop → mobile swap never replays the opening", async () => {
    installMatchMedia(false);
    // Desktop mounts first and plays.
    const desktop = render(<SceneBackdrop wallpaper={PRESET} assetUrl={null} />);
    const desktopBand = desktop.container.querySelector<HTMLElement>(".vela-dawn-horizon__band");
    await waitFor(() => {
      expect(desktopBand!.style.transform).not.toBe("");
    });
    // The opening reaches its end (input jumps it to progress(1)) — only a
    // FINISHED opening counts as played (StrictMode-safe bookkeeping).
    window.dispatchEvent(new Event("pointerdown"));
    expect(desktopBand!.style.transform).toBe("");
    desktop.unmount();
    // The mobile shell mounts the SAME component (its own wallpaper class):
    // the module-scoped session memory refuses a second play.
    const mobile = render(
      <SceneBackdrop wallpaper={PRESET} assetUrl={null} wallpaperClassName="vela-mobile-shell__wallpaper" />,
    );
    expect(mobile.container.querySelector(".vela-mobile-shell__wallpaper")).not.toBeNull();
    const mobileBand = mobile.container.querySelector<HTMLElement>(".vela-dawn-horizon__band");
    const mobileVeil = mobile.container.querySelector<HTMLElement>(".vela-dawn-veil");
    expect(mobileBand!.style.length).toBe(0);
    expect(mobileVeil!.style.length).toBe(0);
  });

  it("two shells mounted at once play at most one opening", async () => {
    installMatchMedia(false);
    const { container } = render(
      <>
        <SceneBackdrop wallpaper={PRESET} assetUrl={null} />
        <SceneBackdrop wallpaper={PRESET} assetUrl={null} wallpaperClassName="vela-mobile-shell__wallpaper" />
      </>,
    );
    const bands = Array.from(container.querySelectorAll<HTMLElement>(".vela-dawn-horizon__band"));
    expect(bands).toHaveLength(2);
    await waitFor(() => {
      expect(bands.filter((band) => band.style.transform !== "")).toHaveLength(1);
    });
  });

  it("a swap that unmounts the first shell MID-PLAY lets the new shell play it", async () => {
    installMatchMedia(false);
    const desktop = render(<SceneBackdrop wallpaper={PRESET} assetUrl={null} />);
    const desktopBand = desktop.container.querySelector<HTMLElement>(".vela-dawn-horizon__band");
    await waitFor(() => {
      expect(desktopBand!.style.transform).not.toBe("");
    });
    // Killed before its end: released, NOT played.
    desktop.unmount();
    const mobile = render(
      <SceneBackdrop wallpaper={PRESET} assetUrl={null} wallpaperClassName="vela-mobile-shell__wallpaper" />,
    );
    const mobileBand = mobile.container.querySelector<HTMLElement>(".vela-dawn-horizon__band");
    await waitFor(() => {
      expect(mobileBand!.style.transform).not.toBe("");
    });
  });
});
