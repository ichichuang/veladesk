// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { gsap } from "@components/vd/gsap";
import { vdMotionDuration } from "@components/vd/motion-tokens";
import { WorkspaceTransition, captureWorkspaceDeparture, preserveDepartureWallpaper, waitForWorkspaceTransition, markSampleDepartureReady, animateWorkspaceEntrance } from "./workspace-motion";
import { MotionToast, MotionToastStack } from "./motion-toast";
import { MotionMenuEntries, WorkspaceMenuRow } from "./workspace-menu-row";
import { WorkspaceWallpaperLayers } from "./desktop-wallpaper";
import { ContextMenu } from "./context-menu";
import type { DesktopMenuEntry } from "./desktop-command-menu";
import { UiLocaleProvider } from "../i18n/ui-locale-provider";
import { useVdHoverLift } from "@components/vd/hover-lift";

const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("@components/vd/reduced-motion", () => ({ useVdReducedMotion: () => preference.reduced }));
beforeEach(() => { preference.reduced = false; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const action = (id: string): Extract<DesktopMenuEntry, { kind: "action" }> => ({ kind: "action", id, label: id, checked: id === "a", onSelect: vi.fn() });
function finish(element: Element) {
  act(() => { gsap.getTweensOf(element).forEach(tween => {
    if (tween.parent && tween.parent !== gsap.globalTimeline) tween.parent.progress(1);
    else tween.progress(1);
  }); });
}
function shell(id: string) { return <main><button>{id}</button></main>; }
function expectClean(element: HTMLElement) {
  expect(element.style.transform).toBe(""); expect(element.style.opacity).toBe(""); expect(element.style.willChange).toBe("");
  expect(gsap.getTweensOf(element)).toHaveLength(0);
}

describe("workspace transition ownership", () => {
  it("latest switch kills its predecessor, ignores stale completion, keeps input live and clears all poses", () => {
    const view = render(<WorkspaceTransition identity="a" ready>{shell("a")}</WorkspaceTransition>);
    const incoming = view.container.querySelector<HTMLElement>(".vela-workspace-transition")!;
    finish(incoming);
    captureWorkspaceDeparture();
    view.rerender(<WorkspaceTransition identity="b" ready>{shell("b")}</WorkspaceTransition>);
    const previous = gsap.getTweensOf(incoming)[0]!.parent!;
    const staleCompletion = previous.eventCallback("onComplete")!;
    expect(previous.duration()).toBeLessThanOrEqual(.4);
    act(() => { previous.progress(.4); });
    const target = view.getByRole("button", { name: "b" });
    target.focus(); expect(document.activeElement).toBe(target);
    captureWorkspaceDeparture();
    view.rerender(<WorkspaceTransition identity="c" ready>{shell("c")}</WorkspaceTransition>);
    expect(previous.parent).toBeNull();
    act(() => { staleCompletion(); });
    expect(view.container.querySelector(".vela-workspace-stage")?.getAttribute("data-settled")).not.toBe("b");
    finish(incoming);
    expect(view.container.querySelector(".vela-workspace-stage")?.getAttribute("data-settled")).toBe("c");
    expect(view.container.querySelector(".vela-workspace-ghost")?.children).toHaveLength(0);
    expectClean(incoming);
    view.unmount(); expectClean(incoming);
  });

  it("reduced motion and preference changes settle immediately with no tween", () => {
    preference.reduced = true;
    const fromTo = vi.spyOn(gsap, "fromTo"); const timeline = vi.spyOn(gsap, "timeline");
    const view = render(<WorkspaceTransition identity="a" ready>{shell("a")}</WorkspaceTransition>);
    captureWorkspaceDeparture();
    view.rerender(<WorkspaceTransition identity="b" ready>{shell("b")}</WorkspaceTransition>);
    const element = view.container.querySelector<HTMLElement>(".vela-workspace-transition")!;
    expect(fromTo).not.toHaveBeenCalled(); expect(timeline).not.toHaveBeenCalled(); expectClean(element);
    preference.reduced = false;
    view.rerender(<WorkspaceTransition identity="c" ready>{shell("c")}</WorkspaceTransition>);
    expect(gsap.getTweensOf(element)).toHaveLength(1);
    preference.reduced = true;
    view.rerender(<WorkspaceTransition identity="c" ready>{shell("c")}</WorkspaceTransition>);
    expectClean(element);
    expect(view.container.querySelector(".vela-workspace-ghost")?.children).toHaveLength(0);
  });

  it("reduced icon entrance skips measurement and tween creation even with visible icons", () => {
    const root = document.createElement("div"); root.innerHTML = '<span class="vela-item__body">Icon</span>';
    const icon = root.firstElementChild as HTMLElement;
    const measure = vi.spyOn(icon, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40, x: 0, y: 0, toJSON() {} });
    const fromTo = vi.spyOn(gsap, "fromTo");
    animateWorkspaceEntrance(root, true)();
    expect(measure).not.toHaveBeenCalled(); expect(fromTo).not.toHaveBeenCalled(); expectClean(icon);
  });
  it("first visits animate only visible icons in grid order and revisits never replay entrance", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const top = this.dataset.offscreen ? 2000 : Number(this.dataset.row ?? 0) * 50;
      return { top, left: 0, right: 40, bottom: top + 40, width: 40, height: 40, x: 0, y: top, toJSON() {} };
    });
    const icons = <><span className="vela-item__body" data-row="1" /><span className="vela-item__body" data-row="0" /><span className="vela-item__body" data-offscreen="true" /></>;
    const view = render(<WorkspaceTransition identity="a" ready>{icons}</WorkspaceTransition>);
    const bodies = Array.from(view.container.querySelectorAll<HTMLElement>(".vela-item__body"));
    expect(gsap.getTweensOf(bodies[2]!)).toHaveLength(0);
    const entrance = gsap.getTweensOf(bodies[0]!)[0]!;
    expect(entrance.targets()[0]).toBe(bodies[1]);
    expect(entrance.duration()).toBeLessThanOrEqual(.5);
    finish(bodies[0]!);
    expectClean(bodies[0]!);
    view.rerender(<WorkspaceTransition identity="b" ready>{icons}</WorkspaceTransition>);
    view.rerender(<WorkspaceTransition identity="a" ready>{icons}</WorkspaceTransition>);
    expect(gsap.getTweensOf(bodies)).toHaveLength(0);
    rect.mockRestore();
  });

  it("unmount kills both layers and the icon entrance without leaving inline styles", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40, x: 0, y: 0, toJSON() {} });
    const view = render(<WorkspaceTransition identity="a" ready><span className="vela-item__body">Icon</span></WorkspaceTransition>);
    view.rerender(<WorkspaceTransition identity="b" ready><span className="vela-item__body">Icon</span></WorkspaceTransition>);
    const icon = view.container.querySelector<HTMLElement>(".vela-workspace-stage > .vela-workspace-transition .vela-item__body")!;
    expect(gsap.getTweensOf(icon)).toHaveLength(1);
    const elements = [...Array.from(view.container.querySelectorAll<HTMLElement>(".vela-workspace-transition")), icon];
    view.unmount(); elements.forEach(expectClean);
  });

  it("rapid cold destinations retain the last painted desktop instead of a loading screen", () => {
    const view = render(<WorkspaceTransition identity="a" ready>{shell("Painted A")}</WorkspaceTransition>);
    finish(view.container.querySelector(".vela-workspace-transition")!);
    captureWorkspaceDeparture();
    view.rerender(<WorkspaceTransition identity="b" ready={false} awaitingPaint>{shell("Loading B")}</WorkspaceTransition>);
    captureWorkspaceDeparture();
    view.rerender(<WorkspaceTransition identity="c" ready={false} awaitingPaint>{shell("Loading C")}</WorkspaceTransition>);
    expect(view.container.querySelector(".vela-workspace-ghost")?.textContent).toBe("Painted A");
    view.rerender(<WorkspaceTransition identity="c" ready>{shell("Painted C")}</WorkspaceTransition>);
    finish(view.container.querySelector(".vela-workspace-transition")!);
    expect(view.container.querySelector(".vela-workspace-ghost")?.children).toHaveLength(0);
  });

  it("a departing boot screen fades away when the next screen is not a workspace (picker)", () => {
    const view = render(<WorkspaceTransition identity="boot" ready={false}>{shell("Opening")}</WorkspaceTransition>);
    captureWorkspaceDeparture();
    view.rerender(<WorkspaceTransition identity="picker" ready={false}>{shell("Pick one")}</WorkspaceTransition>);
    const ghost = view.container.querySelector<HTMLElement>(".vela-workspace-ghost")!;
    finish(ghost); finish(view.container.querySelector(".vela-workspace-transition")!);
    expect(ghost.children).toHaveLength(0);
  });

  it("unmount releases pending switch waiters and removes their event listener", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<WorkspaceTransition identity="a" ready>{shell("a")}</WorkspaceTransition>);
    const done = vi.fn();
    const waiting = waitForWorkspaceTransition("b").then(done);
    view.unmount(); await waiting;
    expect(done).toHaveBeenCalledOnce();
    expect(remove.mock.calls.some(([name]) => name === "vd-workspace-settled")).toBe(true);
  });

  it.each([false, true])("sample button reaches success before the card handoff (reduced=%s)", reduced => {
    preference.reduced = reduced;
    const fromTo = vi.spyOn(gsap, "fromTo");
    const card = <section className="vela-onboarding__panel"><button><span className="vela-onboarding__spinner" /><span data-onboarding-label="">Creating</span></button></section>;
    const view = render(<WorkspaceTransition identity="empty" ready={false}>{card}</WorkspaceTransition>);
    captureWorkspaceDeparture(); markSampleDepartureReady("Ready");
    view.rerender(<WorkspaceTransition identity="created" ready>{shell("Desktop")}</WorkspaceTransition>);
    const ghost = view.container.querySelector<HTMLElement>(".vela-workspace-ghost")!;
    if (reduced) {
      expect(ghost.children).toHaveLength(0); expect(fromTo).not.toHaveBeenCalled();
    } else {
      expect(ghost.querySelector('[data-state="success"]')?.textContent).toBe("Ready");
      expect(ghost.querySelector(".vela-onboarding__spinner")).toBeNull();
      const label = ghost.querySelector<HTMLElement>("[data-onboarding-label]")!;
      view.unmount(); expectClean(label);
    }
  });

  it("retains resolved wallpaper while the incoming asset is cold and cleans its observer/tween", async () => {
    const incoming = document.createElement("div"); const outgoing = document.createElement("div");
    incoming.innerHTML = '<div class="vela-desktop__wallpaper"><div class="vela-desktop__wallpaper-incoming"><div class="vela-wallpaper-surface__pending"></div></div></div>';
    outgoing.innerHTML = '<section data-vd-color-mode="dark" style="--vd-bg: black"><div class="vela-desktop__wallpaper"><img src="blob:resolved" /></div></section>';
    const stop = preserveDepartureWallpaper(incoming, outgoing, false);
    const cover = incoming.querySelector<HTMLElement>(".vela-workspace-wallpaper-cover")!;
    expect(cover.querySelector("img")?.getAttribute("src")).toBe("blob:resolved");
    expect(cover.dataset.vdColorMode).toBe("dark"); expect(cover.style.getPropertyValue("--vd-bg")).toBe("black");
    await act(async () => { incoming.querySelector(".vela-wallpaper-surface__pending")!.remove(); });
    expect(gsap.getTweensOf(cover)).toHaveLength(1);
    stop(); expect(cover.isConnected).toBe(false); expect(gsap.getTweensOf(cover)).toHaveLength(0);
    const tween = vi.spyOn(gsap, "to");
    const reducedStop = preserveDepartureWallpaper(incoming, outgoing, true);
    expect(tween).not.toHaveBeenCalled(); reducedStop();
  });
});

describe("workspace menu presence", () => {
  function list(entries: readonly DesktopMenuEntry[]) {
    return <MotionMenuEntries entries={entries} renderEntry={(entry, _index, exiting, release) => entry.kind === "action" ?
      <WorkspaceMenuRow key={entry.id} entry={entry} exiting={exiting} release={release} onSelect={entry.onSelect} onTool={action => action()} /> : null} />;
  }
  it("collapses a deleted row before removing it and cleans height/overflow on unmount", () => {
    const a = action("a"); const b = action("b");
    const view = render(list([a, b]));
    const row = view.getByRole("menuitemradio", { name: "a" }).parentElement!;
    const entrance = gsap.fromTo(row, { opacity: 0, x: -4 }, { opacity: 1, x: 0, duration: vdMotionDuration("popup") });
    view.rerender(list([b]));
    expect(entrance.parent).toBeNull();
    expect(gsap.getTweensOf(row)).toHaveLength(1);
    const exiting = view.container.querySelector<HTMLElement>('[data-exiting="true"]')!;
    expect(exiting).toBeTruthy(); expect(exiting.hasAttribute("inert")).toBe(true);
    const collapse = gsap.getTweensOf(exiting)[0]!;
    expect(collapse.duration()).toBe(vdMotionDuration("controlState"));
    finish(exiting);
    expect(view.queryByRole("menuitemradio", { name: "a" })).toBeNull();
    expect(view.getByRole("menuitemradio", { name: "b" })).toBeTruthy();
    expect(exiting.style.height).toBe(""); expect(exiting.style.overflow).toBe("");
    view.unmount(); expectClean(exiting);
  });
  it("reduced deletion and check state settle without starting a tween", () => {
    preference.reduced = true;
    const to = vi.spyOn(gsap, "to");
    const view = render(list([action("a"), action("b")]));
    view.rerender(list([action("b")]));
    expect(view.queryByText("a")).toBeNull(); expect(to).not.toHaveBeenCalled();
    expect(view.container.querySelector<HTMLElement>(".vela-context-menu__check")?.style.opacity).toBe("0");
  });
  it("reduced inline rename, tools and name highlight never tween", async () => {
    preference.reduced = true;
    const to = vi.spyOn(gsap, "to"); const fromTo = vi.spyOn(gsap, "fromTo");
    const entry: Extract<DesktopMenuEntry, { kind: "action" }> = { ...action("a"), onRename: vi.fn().mockResolvedValue(null), tools: [{ icon: "rename", label: "Rename", onSelect: vi.fn() }] };
    const view = render(list([entry]));
    fireEvent.mouseEnter(view.container.querySelector(".vela-workspace-menu-row")!);
    fireEvent.click(view.getByRole("button", { name: "Rename" }));
    const input = view.getByRole("textbox"); expect(document.activeElement).toBe(input);
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    expect(view.queryByRole("textbox")).toBeNull();
    view.rerender(list([{ ...entry, label: "Changed" }]));
    expect(to).not.toHaveBeenCalled(); expect(fromTo).not.toHaveBeenCalled();
  });
  it("check and tools fade, inline rename enters/exits, and saving flashes the background", async () => {
    const rename = vi.fn().mockResolvedValue(null);
    const entry: Extract<DesktopMenuEntry, { kind: "action" }> = { ...action("a"), kind: "action", onRename: rename, tools: [{ icon: "rename", label: "Rename", onSelect: vi.fn() }] };
    const view = render(list([entry]));
    const row = view.container.querySelector<HTMLElement>(".vela-workspace-menu-row")!;
    fireEvent.mouseEnter(row);
    const tools = view.container.querySelector<HTMLElement>(".vela-workspace-menu-tools")!;
    expect(gsap.getTweensOf(tools)[0]?.duration()).toBe(vdMotionDuration("hoverPress"));
    fireEvent.click(view.getByRole("button", { name: "Rename" }));
    const input = view.getByRole("textbox") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Changed" } });
    await act(async () => { fireEvent.submit(input.closest("form")!); });
    expect(rename).toHaveBeenCalledWith("Changed"); finish(input);
    expect(view.queryByRole("textbox")).toBeNull(); expectClean(input);
    finish(view.container.querySelector(".vela-context-menu__check")!);
    view.rerender(list([{ ...entry, label: "Changed", checked: false }]));
    const flash = view.container.querySelector<HTMLElement>(".vela-workspace-name-flash")!;
    expect(gsap.getTweensOf(flash)).toHaveLength(1); finish(flash);
    const check = view.container.querySelector<HTMLElement>(".vela-context-menu__check")!;
    expect(Number(check.style.opacity)).toBeGreaterThan(0);
    finish(check); expect(check.style.opacity).toBe("0");
    view.unmount(); expect(gsap.getTweensOf(tools)).toHaveLength(0);
  });
  it("reduced submenu opens and closes synchronously without a timeline", () => {
    preference.reduced = true;
    const timeline = vi.spyOn(gsap, "timeline");
    const view = render(<ContextMenu state={{ x: 10, y: 10, entries: [{ kind: "submenu", id: "workspaces", label: "Workspaces", entries: [action("a")] }] }} onClose={vi.fn()} />);
    fireEvent.click(view.getByRole("menuitem", { name: "Workspaces" }));
    const panel = view.container.querySelector<HTMLElement>(".vela-workspace-submenu")!;
    expectClean(panel); fireEvent.keyDown(panel, { key: "ArrowLeft" });
    expect(view.container.querySelector(".vela-workspace-submenu")).toBeNull();
    expect(timeline).not.toHaveBeenCalled();
  });
  it("submenu flips entry direction, keeps a shorter inert exit and releases after the tween", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const isMenu = this.getAttribute("role") === "menu";
      return { left: isMenu ? 0 : 950, right: isMenu ? 320 : 1000, top: 10, bottom: 50, width: isMenu ? 320 : 50, height: 40, x: 0, y: 10, toJSON() {} };
    });
    const view = render(<ContextMenu state={{ x: 800, y: 20, entries: [{ kind: "submenu", id: "workspaces", label: "Workspaces", entries: [action("a"), action("b")] }] }} onClose={vi.fn()} />);
    fireEvent.click(view.getByRole("menuitem", { name: "Workspaces" }));
    const panel = view.container.querySelector<HTMLElement>(".vela-workspace-submenu")!;
    expect(Number(gsap.getProperty(panel, "x"))).toBeGreaterThan(0);
    finish(panel);
    fireEvent.keyDown(panel, { key: "ArrowLeft" });
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(gsap.getTweensOf(panel)[0]?.duration()).toBe(vdMotionDuration("hoverPress"));
    finish(panel); expect(view.container.querySelector(".vela-workspace-submenu")).toBeNull(); expectClean(panel);
  });
});

describe("toast lifecycle", () => {
  it("uses 8px entrance, 7s lifetime, -4px exit and removes all tweens on dismissal/unmount", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const view = render(<UiLocaleProvider><MotionToast onDismiss={dismiss}>Done</MotionToast></UiLocaleProvider>);
    const toast = view.getByRole("status");
    expect(Number(gsap.getProperty(toast, "y"))).toBe(8);
    finish(toast); expectClean(toast);
    act(() => vi.advanceTimersByTime(6999)); expect(toast.dataset.exiting).toBe("false");
    act(() => vi.advanceTimersByTime(1)); expect(toast.dataset.exiting).toBe("true");
    const exit = gsap.getTweensOf(toast)[0]!; expect(exit.vars.y).toBe(-4);
    finish(toast); expect(dismiss).toHaveBeenCalledOnce();
    view.unmount(); expectClean(toast); expect(vi.getTimerCount()).toBe(0);
  });
  it("reduced toast never starts a tween and dismissal is immediate", () => {
    preference.reduced = true;
    const to = vi.spyOn(gsap, "to"); const fromTo = vi.spyOn(gsap, "fromTo"); const dismiss = vi.fn();
    const view = render(<UiLocaleProvider><MotionToast onDismiss={dismiss}>Done</MotionToast></UiLocaleProvider>);
    fireEvent.click(view.getByRole("button", { name: "关闭" }));
    expect(dismiss).toHaveBeenCalledOnce(); expect(to).not.toHaveBeenCalled(); expect(fromTo).not.toHaveBeenCalled();
    expectClean(view.getByRole("status"));
  });
  it("stack neighbours move on an independent transform slot and reduced reflow never tweens", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const count = this.parentElement?.children.length ?? 0;
      const top = count === 2 ? 100 : 150;
      return { top, left: 0, right: 40, bottom: top + 40, width: 40, height: 40, x: 0, y: top, toJSON() {} };
    });
    const first = <div key="first">First</div>; const second = <div key="second">Second</div>;
    const view = render(<MotionToastStack>{[first, second]}</MotionToastStack>);
    view.rerender(<MotionToastStack>{[first]}</MotionToastStack>);
    const slot = view.getByText("First").parentElement!;
    expect(Number(gsap.getProperty(slot, "y"))).toBe(-50);
    const moving = gsap.getTweensOf(slot)[0]!;
    act(() => { moving.progress(.5); });
    const interruptedY = Number(gsap.getProperty(slot, "y"));
    view.rerender(<MotionToastStack>{[first, second]}</MotionToastStack>);
    expect(Number(gsap.getProperty(slot, "y"))).toBeCloseTo(50 + interruptedY);
    finish(slot); expectClean(slot);
    preference.reduced = true;
    const fromTo = vi.spyOn(gsap, "fromTo");
    view.rerender(<MotionToastStack>{[first]}</MotionToastStack>);
    expect(fromTo).not.toHaveBeenCalled(); expectClean(slot);
    view.unmount(); expectClean(slot);
  });
  it("unmount during toast exit kills it without calling dismissal later", () => {
    const dismiss = vi.fn();
    const view = render(<UiLocaleProvider><MotionToast onDismiss={dismiss}>Done</MotionToast></UiLocaleProvider>);
    const toast = view.getByRole("status"); fireEvent.click(view.getByRole("button", { name: "关闭" }));
    expect(gsap.getTweensOf(toast)).toHaveLength(1);
    view.unmount(); expectClean(toast); expect(dismiss).not.toHaveBeenCalled();
  });
  it("cleans an unfinished entrance on unmount", () => {
    const view = render(<UiLocaleProvider><MotionToast onDismiss={vi.fn()}>Done</MotionToast></UiLocaleProvider>);
    const toast = view.getByRole("status"); view.unmount(); expectClean(toast);
  });
});

function HoverButton() {
  const { innerRef, ...events } = useVdHoverLift<HTMLButtonElement>();
  return <button {...events}><span ref={innerRef}>Icon</span></button>;
}
it("hover/press stay on the inner icon, and reduced pointer leave cannot start a tween", () => {
  const view = render(<HoverButton />); const button = view.getByRole("button"); const icon = view.getByText("Icon");
  fireEvent.pointerDown(button); finish(icon); expect(Number(gsap.getProperty(icon, "scale"))).toBe(.98);
  expect(button.style.transform).toBe("");
  preference.reduced = true; view.rerender(<HoverButton />);
  fireEvent.pointerEnter(button); fireEvent.pointerLeave(button); fireEvent.pointerDown(button); fireEvent.pointerUp(button);
  expectClean(icon); view.unmount(); expectClean(icon);
});


describe("wallpaper crossfade cleanup", () => {
  const wallpaper = (presetId: "mist" | "dawn") => ({ config: { kind: "preset" as const, presetId }, provenance: "workspace" as const });
  it.each([false, true])("crossfade settles directly or kills on unmount (reduced=%s)", reduced => {
    preference.reduced = reduced;
    const fromTo = vi.spyOn(gsap, "fromTo");
    const view = render(<WorkspaceWallpaperLayers wallpaper={wallpaper("mist")} assetUrl={null} />);
    view.rerender(<WorkspaceWallpaperLayers wallpaper={wallpaper("dawn")} assetUrl={null} />);
    const incoming = view.container.querySelector<HTMLElement>(".vela-desktop__wallpaper-incoming")!;
    expect(gsap.getTweensOf(incoming)).toHaveLength(reduced ? 0 : 1);
    if (reduced) { expect(fromTo).not.toHaveBeenCalled(); expect(view.container.querySelectorAll(".vela-wallpaper-surface--preset")).toHaveLength(1); }
    view.unmount(); expectClean(incoming);
  });
});
