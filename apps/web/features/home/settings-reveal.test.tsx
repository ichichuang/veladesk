// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsReveal } from "./settings-reveal";

function forceReducedMotion(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

describe("SettingsReveal (user-report fix)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders its row while open", () => {
    render(
      <SettingsReveal open>
        <p>row-content</p>
      </SettingsReveal>,
    );
    expect(screen.getByText("row-content")).not.toBeNull();
  });

  it("never mounts the row before it is first opened", () => {
    const { rerender } = render(
      <SettingsReveal open={false}>
        <p>row-content</p>
      </SettingsReveal>,
    );
    expect(screen.queryByText("row-content")).toBeNull();
    rerender(
      <SettingsReveal open>
        <p>row-content</p>
      </SettingsReveal>,
    );
    expect(screen.getByText("row-content")).not.toBeNull();
  });

  it("under reduced motion, closing releases the row immediately (no waiting frame)", () => {
    forceReducedMotion();
    const { rerender } = render(
      <SettingsReveal open>
        <p>row-content</p>
      </SettingsReveal>,
    );
    expect(screen.getByText("row-content")).not.toBeNull();
    rerender(
      <SettingsReveal open={false}>
        <p>row-content</p>
      </SettingsReveal>,
    );
    expect(screen.queryByText("row-content")).toBeNull();
  });

  it("keeps the open wrapper interactive (no inert while open)", () => {
    forceReducedMotion();
    render(
      <SettingsReveal open>
        <p>row-content</p>
      </SettingsReveal>,
    );
    const wrapper = screen.getByText("row-content").parentElement!;
    expect(wrapper.getAttribute("inert")).toBeNull();
    expect(wrapper.getAttribute("aria-hidden")).toBeNull();
  });
});
