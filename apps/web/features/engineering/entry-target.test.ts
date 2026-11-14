// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  ENGINEERING_ENTRY_CLICKS,
  ENGINEERING_ENTRY_WINDOW_MS,
  feedEngineeringClickTrain,
  isEngineeringEntryTarget,
} from "./entry-target";

/** Minimal DOM helper: one element matching `html` body inner markup. */
function elementFrom(markup: string, inside?: Element): Element {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const target = host.firstElementChild!;
  (inside ?? document.body).append(host);
  return target;
}

/** Builds the click target context: `.vela-workbench > .vela-section-scroller` background. */
function desktopBackgroundTarget(innerMarkup = ""): Element {
  const workbench = elementFrom(
    `<div class="vela-workbench"><div class="vela-section-scroller">${innerMarkup}</div></div>`,
  );
  const scroller = workbench.querySelector(".vela-section-scroller")!;
  return innerMarkup === "" ? scroller : scroller.firstElementChild!;
}

describe("isEngineeringEntryTarget", () => {
  it("accepts the empty desktop background (workbench/scroller/frame)", () => {
    expect(isEngineeringEntryTarget(desktopBackgroundTarget())).toBe(true);
    const gridFrame = elementFrom(
      `<div class="vela-workbench"><div class="vela-grid-frame"></div></div>`,
    ).querySelector(".vela-grid-frame")!;
    expect(isEngineeringEntryTarget(gridFrame)).toBe(true);
  });

  it("accepts a child of the background that is not itself interactive", () => {
    const label = desktopBackgroundTarget(`<p class="vela-empty-section__text">text</p>`);
    expect(isEngineeringEntryTarget(label)).toBe(true);
  });

  it("accepts elements marked data-vd-eng-entry (brand/title areas)", () => {
    const wordmark = elementFrom(`<h1 class="vela-wordmark" data-vd-eng-entry="">VelaDesk</h1>`);
    expect(isEngineeringEntryTarget(wordmark)).toBe(true);
    // Even nested inside the brand area.
    const nested = elementFrom(
      `<div data-vd-eng-entry=""><span>工作区名</span></div>`,
    ).firstElementChild!;
    expect(isEngineeringEntryTarget(nested)).toBe(true);
  });

  it("rejects app tiles and everything interactive", () => {
    expect(isEngineeringEntryTarget(desktopBackgroundTarget(`<li class="vela-item">app</li>`))).toBe(false);
    expect(isEngineeringEntryTarget(desktopBackgroundTarget(`<button>打开</button>`))).toBe(false);
    expect(isEngineeringEntryTarget(desktopBackgroundTarget(`<a href="#">link</a>`))).toBe(false);
    expect(isEngineeringEntryTarget(desktopBackgroundTarget(`<input />`))).toBe(false);
    expect(
      isEngineeringEntryTarget(desktopBackgroundTarget(`<span role="button">x</span>`)),
    ).toBe(false);
  });

  it("rejects chrome: dock, section pill, launcher, mobile tabs, tiles", () => {
    for (const className of [
      "vela-dock",
      "vela-pill",
      "vela-launcher",
      "vela-mobile-dock",
      "vela-mobile-category-tabs",
      "vela-mobile-search",
    ]) {
      const chrome = elementFrom(`<div class="${className}"></div>`);
      expect(isEngineeringEntryTarget(chrome)).toBe(false);
    }
    const mobileTile = elementFrom(`<li class="vela-mobile-tile"><button></button></li>`);
    expect(isEngineeringEntryTarget(mobileTile)).toBe(false);
    expect(isEngineeringEntryTarget(mobileTile.querySelector("button")!)).toBe(false);
  });

  it("accepts the mobile content background", () => {
    const content = elementFrom(`<div class="vela-mobile-shell__content"></div>`);
    expect(isEngineeringEntryTarget(content)).toBe(true);
  });

  it("rejects elements inside overlay portals (dialogs, menus, sheets)", () => {
    const portal = elementFrom(
      `<div data-vd-portal-root=""><div role="dialog"><p>text</p></div></div>`,
    );
    expect(isEngineeringEntryTarget(portal.querySelector("p")!)).toBe(false);
  });
});

describe("feedEngineeringClickTrain", () => {
  it("unlocks on the 7th click inside the window and resets", () => {
    let state = { count: 0, lastClickMs: 0 };
    let unlocked = false;
    for (let index = 1; index <= ENGINEERING_ENTRY_CLICKS; index++) {
      const next = feedEngineeringClickTrain(state, true, index * 100);
      state = next.state;
      unlocked ||= next.unlocked;
    }
    expect(unlocked).toBe(true);
    expect(state.count).toBe(0);
  });

  it("resets the train when the gap exceeds the window", () => {
    let state = { count: 0, lastClickMs: 0 };
    state = feedEngineeringClickTrain(state, true, 0).state;
    state = feedEngineeringClickTrain(state, true, 100).state;
    expect(state.count).toBe(2);
    // Beyond the 400ms window: the next click restarts at 1.
    state = feedEngineeringClickTrain(
      state,
      true,
      100 + ENGINEERING_ENTRY_WINDOW_MS + 1,
    ).state;
    expect(state.count).toBe(1);
  });

  it("a non-qualifying click resets the train entirely", () => {
    let state = { count: 0, lastClickMs: 0 };
    for (let index = 1; index <= 5; index++) {
      state = feedEngineeringClickTrain(state, true, index * 100).state;
    }
    expect(state.count).toBe(5);
    state = feedEngineeringClickTrain(state, false, 600).state;
    expect(state).toEqual({ count: 0, lastClickMs: 0 });
  });
});
