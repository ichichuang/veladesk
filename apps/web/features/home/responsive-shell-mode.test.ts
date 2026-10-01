import { describe, expect, it } from "vitest";

import {
  COARSE_TOUCH_VIEWPORT_QUERY,
  MOBILE_SHELL_QUERY,
  NARROW_VIEWPORT_QUERY,
  readShellModeMatches,
  resolveWorkspaceShellMode,
} from "./responsive-shell-mode";

/**
 * Task 026 §5/§6/§70: the shell mode is derived from capability/media
 * queries only — no UA sniffing, no `any-pointer: coarse`, no persisted
 * preference. The exact viewport matrix of §70 is pinned here.
 */

describe("resolveWorkspaceShellMode", () => {
  it("390×844 phone portrait (narrow) → mobile", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: true, coarseTouchViewport: false })).toBe("mobile");
  });

  it("430px large phone (narrow) → mobile", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: true, coarseTouchViewport: true })).toBe("mobile");
  });

  it("844×390 phone landscape (768–1024 coarse, no hover) → mobile", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: false, coarseTouchViewport: true })).toBe("mobile");
  });

  it("768×1024 touch tablet portrait → mobile", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: false, coarseTouchViewport: true })).toBe("mobile");
  });

  it("1024×768 touch tablet landscape → mobile", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: false, coarseTouchViewport: true })).toBe("mobile");
  });

  it("800px + fine pointer desktop window → desktop", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: false, coarseTouchViewport: false })).toBe("desktop");
  });

  it("1280px + fine pointer → desktop", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: false, coarseTouchViewport: false })).toBe("desktop");
  });

  it("1440px desktop with a secondary touchscreen but fine primary pointer → desktop (§5: no any-pointer)", () => {
    // The secondary touchscreen never flips the PRIMARY-pointer leg: a
    // coarse `any-pointer` match must not force mobile.
    expect(resolveWorkspaceShellMode({ narrowViewport: false, coarseTouchViewport: false })).toBe("desktop");
  });

  it("narrow beats everything — a 700px desktop window is mobile (leg A)", () => {
    expect(resolveWorkspaceShellMode({ narrowViewport: true, coarseTouchViewport: false })).toBe("mobile");
  });
});

describe("canonical query strings", () => {
  it("never sniffs UA and never uses any-pointer", () => {
    const all = `${MOBILE_SHELL_QUERY} ${NARROW_VIEWPORT_QUERY} ${COARSE_TOUCH_VIEWPORT_QUERY}`;
    expect(all).not.toContain("any-pointer");
    expect(all).not.toMatch(/iPhone|Android|iPad|Safari/i);
  });

  it("the narrow leg is exactly <= 767px", () => {
    expect(NARROW_VIEWPORT_QUERY).toBe("(max-width: 767px)");
  });

  it("the coarse-touch leg is 768–1024px + hover:none + pointer:coarse", () => {
    expect(COARSE_TOUCH_VIEWPORT_QUERY).toBe(
      "(max-width: 1024px) and (hover: none) and (pointer: coarse)",
    );
  });

  it("the canonical query is the union of both legs", () => {
    expect(MOBILE_SHELL_QUERY).toBe(`${NARROW_VIEWPORT_QUERY}, ${COARSE_TOUCH_VIEWPORT_QUERY}`);
  });
});

describe("readShellModeMatches", () => {
  it("reads both legs from the matchMedia source", () => {
    const seen: string[] = [];
    const matches = readShellModeMatches((query) => {
      seen.push(query);
      return { matches: query === NARROW_VIEWPORT_QUERY };
    });
    expect(matches).toEqual({ narrowViewport: true, coarseTouchViewport: false });
    expect(seen).toEqual([NARROW_VIEWPORT_QUERY, COARSE_TOUCH_VIEWPORT_QUERY]);
  });
});
