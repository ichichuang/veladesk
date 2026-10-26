// @vitest-environment jsdom
/*
 * The OS color-scheme bridge (021-R1 / mobile live-switch bug): every themed
 * root — desktop, mobile shell, shared portal root — resolves "system"
 * through this ONE hook, so a live OS switch must reach it without a
 * reload.
 *
 * What this file locks down: an OS switch made while the page sat in the
 * background (no `change` event delivered) is picked up when the page comes
 * back, and the legacy `addListener` spelling (Safari < 14) still
 * subscribes instead of throwing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";

import {
  COLOR_SCHEME_QUERY,
  prefersLightNow,
  subscribeColorScheme,
  useSystemPrefersLight,
} from "./use-system-prefers-light";

type ChangeListener = (event: { matches: boolean }) => void;

/**
 * A matchMedia double in the MODERN spelling. `legacy` swaps
 * addEventListener/removeEventListener for addListener/removeListener, the
 * way old mobile Safari ships it.
 */
function installMatchMedia(prefersLight: () => boolean, options: { legacy?: boolean } = {}) {
  const listeners = new Set<ChangeListener>();
  vi.stubGlobal(
    "matchMedia",
    (query: string) => {
      const mql: Record<string, unknown> = {
        get matches() {
          return query === COLOR_SCHEME_QUERY ? prefersLight() : false;
        },
        media: query,
        onchange: null,
        dispatchEvent: () => false,
      };
      if (options.legacy === true) {
        mql["addListener"] = (listener: ChangeListener) => listeners.add(listener);
        mql["removeListener"] = (listener: ChangeListener) => listeners.delete(listener);
      } else {
        mql["addEventListener"] = (_type: string, listener: ChangeListener) =>
          listeners.add(listener);
        mql["removeEventListener"] = (_type: string, listener: ChangeListener) =>
          listeners.delete(listener);
      }
      return mql as unknown as MediaQueryList;
    },
  );
  return {
    listenerCount: () => listeners.size,
    flip() {
      for (const listener of [...listeners]) {
        listener({ matches: prefersLight() });
      }
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("prefersLightNow", () => {
  it("reads the OS preference (SSR-safe, dark when the capability is absent)", () => {
    expect(prefersLightNow()).toBe(false);
    installMatchMedia(() => true);
    expect(prefersLightNow()).toBe(true);
  });
});

describe("subscribeColorScheme", () => {
  it("uses addEventListener when available and unsubscribes symmetrically", () => {
    const added: string[] = [];
    const removed: string[] = [];
    const unsubscribe = subscribeColorScheme(
      {
        matches: false,
        addEventListener: (type) => added.push(type),
        removeEventListener: (type) => removed.push(type),
      },
      () => {},
    );
    expect(added).toEqual(["change"]);
    unsubscribe();
    expect(removed).toEqual(["change"]);
  });

  it("falls back to the legacy addListener API (Safari < 14)", () => {
    const added: ChangeListener[] = [];
    const removed: ChangeListener[] = [];
    const unsubscribe = subscribeColorScheme(
      {
        matches: false,
        addListener: (listener) => added.push(listener as unknown as ChangeListener),
        removeListener: (listener) => removed.push(listener as unknown as ChangeListener),
      },
      () => {},
    );
    expect(added).toHaveLength(1);
    unsubscribe();
    expect(removed).toEqual(added);
  });

  it("is a no-op — never a throw — when the MQL has neither API", () => {
    expect(() => subscribeColorScheme({ matches: false }, () => {})()).not.toThrow();
  });
});

describe("useSystemPrefersLight", () => {
  it("reads the OS preference on the first render (no wrong-palette frame)", () => {
    installMatchMedia(() => true);
    expect(renderHook(() => useSystemPrefersLight()).result.current).toBe(true);
  });

  it("defaults to dark when matchMedia is unavailable (SSR / old jsdom)", () => {
    expect(renderHook(() => useSystemPrefersLight()).result.current).toBe(false);
  });

  it("follows a live change event without a reload", () => {
    let light = false;
    const media = installMatchMedia(() => light);
    const { result } = renderHook(() => useSystemPrefersLight());
    expect(result.current).toBe(false);

    light = true;
    act(() => {
      media.flip();
    });
    expect(result.current).toBe(true);

    light = false;
    act(() => {
      media.flip();
    });
    expect(result.current).toBe(false);
  });

  it("still follows a live change on legacy-Safari matchMedia (the bug)", () => {
    let light = false;
    const media = installMatchMedia(() => light, { legacy: true });
    const { result } = renderHook(() => useSystemPrefersLight());
    expect(result.current).toBe(false);

    light = true;
    act(() => {
      media.flip();
    });
    expect(result.current).toBe(true);
  });

  it("re-reads the OS preference when the page comes back (missed change event)", () => {
    let light = false;
    installMatchMedia(() => light);
    const { result } = renderHook(() => useSystemPrefersLight());
    expect(result.current).toBe(false);

    // The switch happened while the page was suspended: no `change` fired.
    light = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(true);

    light = false;
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(result.current).toBe(false);

    light = true;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe(true);
  });

  it("subscribes immediately (one listener per mount) and cleans up", () => {
    const media = installMatchMedia(() => true);
    const { unmount } = renderHook(() => useSystemPrefersLight());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
