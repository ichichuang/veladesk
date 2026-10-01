// @vitest-environment jsdom
/*
 * Task 026 §6/§7/§71 — the shell-mode hook contract: capability-unresolved
 * renders nothing, a real matchMedia resolves on the FIRST render (no
 * desktop flash on a phone), and live change events re-resolve the mode
 * (resize / rotate) without ever consulting the UA.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";

import { useWorkspaceShellMode } from "./use-workspace-shell-mode";

type ChangeListener = (event: { matches: boolean }) => void;

/**
 * A controllable matchMedia double: `isMobile(query)` decides live matches,
 * and `flip()` re-evaluates and notifies every registered listener — the
 * browser's behavior on resize/rotation.
 */
function installMatchMedia(isMobile: (query: string) => boolean) {
  const listenersByQuery = new Map<string, Set<ChangeListener>>();
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      get matches() {
        return isMobile(query);
      },
      media: query,
      onchange: null,
      addEventListener(_type: string, listener: ChangeListener) {
        const listeners = listenersByQuery.get(query) ?? new Set<ChangeListener>();
        listeners.add(listener);
        listenersByQuery.set(query, listeners);
      },
      removeEventListener(_type: string, listener: ChangeListener) {
        listenersByQuery.get(query)?.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
  return {
    flip() {
      for (const [query, listeners] of listenersByQuery) {
        const matches = isMobile(query);
        for (const listener of listeners) {
          listener({ matches });
        }
      }
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useWorkspaceShellMode", () => {
  it("unresolved (no matchMedia at all): stays null — neither shell may mount (§71)", () => {
    const { result } = renderHook(() => useWorkspaceShellMode());
    expect(result.current).toBeNull();
  });

  it("resolves mobile on the FIRST render — no desktop-first frame on a phone (§7)", () => {
    installMatchMedia((query) => query.includes("767"));
    const { result } = renderHook(() => useWorkspaceShellMode());
    expect(result.current).toBe("mobile");
  });

  it("resolves desktop on the first render for a fine-pointer wide viewport", () => {
    installMatchMedia(() => false);
    const { result } = renderHook(() => useWorkspaceShellMode());
    expect(result.current).toBe("desktop");
  });

  it("a live change re-resolves: desktop → mobile on narrow resize, and back (§65/§66)", () => {
    let mobile = false;
    const media = installMatchMedia(() => mobile);
    const { result } = renderHook(() => useWorkspaceShellMode());
    expect(result.current).toBe("desktop");

    mobile = true;
    act(() => {
      media.flip();
    });
    expect(result.current).toBe("mobile");

    mobile = false;
    act(() => {
      media.flip();
    });
    expect(result.current).toBe("desktop");
  });
});
