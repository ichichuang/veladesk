// @vitest-environment jsdom
/*
 * Task 026-R2 §21/§22 (H6) — the shared icon layer's cold-work lifecycle:
 * a library icon's probe result and an uploaded asset's object URL are
 * cached at the icon LAYER, so a remount (every mobile section switch
 * remounts tiles) neither re-probes the network image nor re-fetches /
 * re-decodes the asset. No second cache system — the cache lives inside
 * app-icon-renderer.tsx, next to the wallpaper layer's established
 * object-URL pattern.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { AppShortcut } from "@veladesk/domain";

import { AppIconTile } from "./app-icon-renderer";

const iconifyApp: AppShortcut = {
  kind: "app",
  id: "app-lib",
  name: "GitHub",
  url: "https://github.com/",
  icon: { kind: "iconify", icon: "simple-icons:github" },
  openMode: "new-tab",
  tags: [],
};

const assetApp: AppShortcut = {
  kind: "app",
  id: "app-asset",
  name: "Self Hosted",
  url: "https://example.com/",
  icon: { kind: "asset", assetId: "asset-icon-1" },
  openMode: "new-tab",
  tags: [],
};

/** Controlled Image double: onload fires when the test pumps it. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  static instances: FakeImage[] = [];
  constructor() {
    FakeImage.instances.push(this);
  }
}

const loadAsset = vi.fn(async (assetId: string) => ({
  ok: true,
  blob: new Blob([`bytes-${assetId}`], { type: "image/png" }),
}));

vi.mock("../assets/browser-assets", () => ({
  getBrowserAssetRuntime: async () => ({ loadAsset: (id: string) => loadAsset(id) }),
}));

beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal("Image", FakeImage);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("library icon probe cache (§21)", () => {
  it("a remounted icon never re-probes — the cached result renders immediately", async () => {
    const first = render(<AppIconTile app={iconifyApp} />);
    // First mount: one probe; let it complete (a real network callback).
    expect(FakeImage.instances).toHaveLength(1);
    FakeImage.instances[0]!.onload?.();
    await waitFor(() => {
      expect(first.container.querySelector("img, .vela-app-icon__glyph")).not.toBeNull();
    });
    first.unmount();

    // Remount AFTER the probe completed: renders the glyph synchronously
    // from the layer cache and creates NO new probe.
    const second = render(<AppIconTile app={iconifyApp} />);
    expect(second.container.querySelector("img, .vela-app-icon__glyph")).not.toBeNull();
    expect(FakeImage.instances).toHaveLength(1);
    second.unmount();

    // And again — still one probe total, forever.
    const third = render(<AppIconTile app={iconifyApp} />);
    expect(third.container.querySelector("img, .vela-app-icon__glyph")).not.toBeNull();
    expect(FakeImage.instances).toHaveLength(1);
  });
});

describe("uploaded asset icon URL cache (§22)", () => {
  it("a remounted asset icon reuses the object URL — one load, no revoke churn", async () => {
    const first = render(<AppIconTile app={assetApp} />);
    await waitFor(() => {
      expect(first.container.querySelector("img.vela-app-icon__image")).not.toBeNull();
    });
    const firstUrl = (first.container.querySelector("img.vela-app-icon__image") as HTMLImageElement).src;
    expect(loadAsset).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(<AppIconTile app={assetApp} />);
    await waitFor(() => {
      expect(second.container.querySelector("img.vela-app-icon__image")).not.toBeNull();
    });
    // Same object URL, served from the layer cache — no second load.
    expect(
      (second.container.querySelector("img.vela-app-icon__image") as HTMLImageElement).src,
    ).toBe(firstUrl);
    expect(loadAsset).toHaveBeenCalledTimes(1);
  });
});
