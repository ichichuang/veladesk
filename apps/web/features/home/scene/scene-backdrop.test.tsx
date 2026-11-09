// @vitest-environment jsdom
/*
 * The scene backdrop's Dawn gate (P1, motion-spec-p1 §2): Dawn is ON BY
 * DEFAULT — no helmMotion switch is consulted — over a PRESET scene; a
 * custom image wallpaper renders no horizon and never plays the opening;
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
    expect(container.querySelector(".vela-dawn-horizon")).toBeNull();
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
