// @vitest-environment jsdom
/*
 * task 029 block visibility: the Helm blocks render behind three
 * independent flags (time / date / command bar), the whole band collapses
 * when everything is off, and the shell gates the dock + section pill and
 * gives the reserved band padding back through data-helm-hidden /
 * data-pill-hidden. Mobile's compact clock band follows the same
 * preference; Settings exposes one switch per block.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { HelmHeader } from "./helm-header";
import { HelmClock } from "./helm-clock";
import { UiLocaleProvider } from "../../i18n/ui-locale-provider";

function readSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

describe("HelmHeader block visibility (task 029)", () => {
  afterEach(cleanup);

  function renderHeader(props: Partial<Parameters<typeof HelmHeader>[0]> = {}) {
    return render(
      <UiLocaleProvider>
        <HelmHeader onOpenCommands={() => {}} {...props} />
      </UiLocaleProvider>,
    );
  }

  it("renders the clock (time + date) and the command bar by default", () => {
    renderHeader();
    expect(document.querySelector(".vela-helm-clock__time")).not.toBeNull();
    expect(document.querySelector(".vela-helm-clock__date")).not.toBeNull();
    expect(document.querySelector(".vela-helm-commandbar")).not.toBeNull();
  });

  it("hides the time but keeps the date and the command bar", () => {
    renderHeader({ showClock: false });
    // Entrance/exit rework: blocks stay MOUNTED and toggle data-hidden —
    // the ease plays on the CSS side instead of a hard unmount.
    expect(document.querySelector(".vela-helm-clock__time")).not.toBeNull();
    expect(
      document.querySelector(".vela-helm-clock__time")?.getAttribute("data-vd-block-hidden"),
    ).toBe("true");
    expect(document.querySelector(".vela-helm-clock__date")).not.toBeNull();
    expect(document.querySelector(".vela-helm-commandbar")).not.toBeNull();
  });

  it("hides the date but keeps the time", () => {
    renderHeader({ showDate: false });
    expect(document.querySelector(".vela-helm-clock__time")).not.toBeNull();
    expect(document.querySelector(".vela-helm-clock__date")?.getAttribute("data-vd-block-hidden")).toBe(
      "true",
    );
  });

  it("keeps every helm block mounted (hidden, not unmounted) when all are off", () => {
    renderHeader({ showClock: false, showDate: false, showCommandBar: false });
    expect(document.querySelector(".vela-helm-clock__time")).not.toBeNull();
    expect(document.querySelector(".vela-helm-clock__date")).not.toBeNull();
    expect(document.querySelector(".vela-helm-commandbar")).not.toBeNull();
    expect(
      document.querySelectorAll('[data-vd-block-hidden="true"]').length,
    ).toBe(3);
  });
});

describe("HelmClock block visibility (task 029)", () => {
  afterEach(cleanup);

  it("renders date-only when the time is off (time span stays mounted, data-hidden)", () => {
    render(<HelmClock locale="zh-CN" showTime={false} />);
    expect(document.querySelector(".vela-helm-clock__time")?.getAttribute("data-vd-block-hidden")).toBe(
      "true",
    );
    expect(document.querySelector(".vela-helm-clock__date")).not.toBeNull();
  });

  it("keeps both spans mounted (hidden) when the time and the date are off", () => {
    render(<HelmClock locale="zh-CN" showTime={false} showDate={false} />);
    expect(document.querySelector(".vela-helm-clock")).not.toBeNull();
    expect(
      document.querySelectorAll('.vela-helm-clock [data-vd-block-hidden="true"]').length,
    ).toBe(2);
  });
});

describe("desktop shell block gating (source contract)", () => {
  const shell = readSource("./desktop-shell.tsx");
  const css = readSource("../home-shell.css");
  const mobile = readSource("../mobile/mobile-shell.tsx");
  const sections = readSource("../settings-sections.tsx");

  it("gates every block through resolveBlockVisibility on the resolved appearance", () => {
    expect(shell).toMatch(/resolveBlockVisibility\(resolvedAppearance\)/);
    // Entrance/exit rework: dock/pill stay mounted behind hidden props.
    expect(shell).toMatch(/hidden=\{!blockVisibility\.dock\}/);
    expect(shell).toMatch(/hidden=\{!blockVisibility\.sectionPill\}/);
    expect(shell).toMatch(/showClock=\{blockVisibility\.helmClock\}/);
    expect(shell).toMatch(/showDate=\{blockVisibility\.helmDate\}/);
    expect(shell).toMatch(/showCommandBar=\{blockVisibility\.commandBar\}/);
  });

  it("a preference-hidden dock clears its layout reserve too", () => {
    expect(shell).toMatch(/data-has-dock=\{hasDock && blockVisibility\.dock/);
  });

  it("hidden blocks zero their band tokens so ANY combination shrinks the reserve (F1)", () => {
    // Granular markers on the desktop root (replacing the all-off-only
    // data-helm-hidden of the first 029 cut).
    expect(shell).toMatch(/data-helm-clock-off=\{blockVisibility\.helmClock \? undefined : "true"\}/);
    expect(shell).toMatch(/data-helm-date-off=\{blockVisibility\.helmDate \? undefined : "true"\}/);
    expect(shell).toMatch(/data-helm-bar-off=\{blockVisibility\.commandBar \? undefined : "true"\}/);
    expect(shell).not.toMatch(/data-helm-hidden/);
    // The zeroing rules: clock, date, bar, and the clock+date pair.
    expect(css).toMatch(
      /\.vela-desktop\[data-helm-clock-off="true"\]\s*\{[\s\S]*?--vd-helm-clock-size: 0px/,
    );
    expect(css).toMatch(
      /\.vela-desktop\[data-helm-date-off="true"\]\s*\{[\s\S]*?--vd-helm-date-size: 0px/,
    );
    expect(css).toMatch(
      /\.vela-desktop\[data-helm-bar-off="true"\]\s*\{[\s\S]*?--vd-helm-bar-height: 0px/,
    );
    expect(css).toMatch(
      /\.vela-desktop\[data-helm-clock-off="true"\]\[data-helm-date-off="true"\]\s*\{[\s\S]*?--vd-helm-gap: 0px/,
    );
  });

  it("a hidden block's presentation overrides are dropped (inline vars would out-specify the zeroing)", () => {
    expect(shell).toMatch(/blockVisibility\.helmClock \|\| !key\.startsWith\("--vd-helm-clock"\)/);
    expect(shell).toMatch(/blockVisibility\.helmDate \|\| !key\.startsWith\("--vd-helm-date"\)/);
  });

  it("the pill share of the bottom reserve drops only when the pill is hidden", () => {
    expect(css).toMatch(
      /\.vela-desktop\[data-has-dock="true"\]\[data-pill-hidden="true"\] \.vela-section-viewport/,
    );
    expect(css).toMatch(
      /\.vela-desktop\[data-has-dock="false"\]\[data-pill-hidden="true"\] \.vela-section-viewport/,
    );
  });

  it("the mobile clock band follows the same preference", () => {
    expect(mobile).toMatch(/resolveBlockVisibility/);
    expect(mobile).toMatch(/showTime=\{clockBlockVisibility\.helmClock\}/);
    expect(mobile).toMatch(/showDate=\{clockBlockVisibility\.helmDate\}/);
  });

  it("Settings exposes one switch per block (task 029)", () => {
    expect(sections).toMatch(/data-settings-block-visibility=""/);
    for (const field of [
      "showHelmClock",
      "showHelmDate",
      "showCommandBar",
      "showDock",
      "showSectionPill",
    ]) {
      expect(sections).toContain(`"${field}"`);
    }
  });
});
