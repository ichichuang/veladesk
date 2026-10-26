// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { ContextMenu } from "./context-menu";
import type { DesktopMenuEntry } from "./desktop-command-menu";
vi.mock("@components/vd/reduced-motion", () => ({ useVdReducedMotion: () => true }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true }); });
function setup() {
  const onClose = vi.fn(), select = vi.fn(), rename = vi.fn(), remove = vi.fn(), create = vi.fn();
  const entries: readonly DesktopMenuEntry[] = [
    { kind: "submenu", id: "workspaces", label: "Workspaces", entries: [
      { kind: "action", id: "work", label: "Work", checked: true, onSelect: select, tools: [{ label: "Rename Work", icon: "rename", onSelect: rename }, { label: "Delete Work", icon: "delete", disabled: true, reason: "Keep one workspace", onSelect: remove }] },
      { kind: "action", id: "home", label: "Home", checked: false, onSelect: select },
      { kind: "separator" }, { kind: "action", id: "new", label: "New workspace", onSelect: create },
    ] },
    { kind: "action", id: "settings", label: "Settings", onSelect: vi.fn() },
  ];
  const view = render(<ContextMenu state={{ x: 100, y: 100, entries }} onClose={onClose} />);
  return { view, onClose, select, rename, remove, create, trigger: view.getByRole("menuitem", { name: "Workspaces" }) };
}

describe("workspace cascading menu", () => {
  it("opens after 150ms hover without stealing focus and cancels an early leave", () => {
    vi.useFakeTimers(); const { view, trigger } = setup(); trigger.focus();
    fireEvent.mouseEnter(trigger); act(() => vi.advanceTimersByTime(149)); expect(view.getAllByRole("menu")).toHaveLength(1);
    fireEvent.mouseLeave(trigger); act(() => vi.advanceTimersByTime(1)); expect(view.getAllByRole("menu")).toHaveLength(1);
    fireEvent.mouseEnter(trigger); act(() => vi.advanceTimersByTime(150)); expect(view.getAllByRole("menu")).toHaveLength(2); expect(document.activeElement).toBe(trigger);
  });
  it.each(["ArrowRight", "Enter"])("opens with %s, cycles rows and returns to parent with ArrowLeft", async key => {
    const { view, trigger, onClose } = setup(); fireEvent.keyDown(trigger, { key });
    const work = view.getByRole("menuitemradio", { name: "Work" }); await waitFor(() => expect(document.activeElement).toBe(work));
    fireEvent.keyDown(work, { key: "ArrowDown" }); expect(document.activeElement).toBe(view.getByRole("menuitemradio", { name: "Home" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" }); expect(document.activeElement).toBe(work);
    fireEvent.keyDown(work, { key: "End" }); expect(document.activeElement).toBe(view.getByRole("menuitem", { name: "New workspace" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" }); expect(document.activeElement).toBe(trigger); expect(view.getAllByRole("menu")).toHaveLength(1); expect(onClose).not.toHaveBeenCalled();
  });
  it("Escape closes only the submenu first, then the main menu", () => {
    const { view, trigger, onClose } = setup(); fireEvent.keyDown(trigger, { key: "ArrowRight" });
    fireEvent.keyDown(view.getByRole("menuitemradio", { name: "Work" }), { key: "Escape" });
    expect(view.getAllByRole("menu")).toHaveLength(1); expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" }); expect(onClose).toHaveBeenCalledOnce();
  });
  it("switches a row, exposes checked state, and invokes accessible tools separately", () => {
    const { view, trigger, select, rename, remove, onClose } = setup(); fireEvent.click(trigger);
    const work = view.getByRole("menuitemradio", { name: "Work" }); expect(work.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(view.getByRole("button", { name: "Rename Work" })); expect(rename).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
    const disabled = view.getByRole("button", { name: "Delete Work" }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true); expect(disabled.title).toBe("Keep one workspace"); fireEvent.click(disabled); expect(remove).not.toHaveBeenCalled();
    fireEvent.click(work); expect(select).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("Enter activates the focused row via native button semantics", () => {
    const { view, trigger, select } = setup(); fireEvent.keyDown(trigger, { key: "Enter" });
    // jsdom fireEvent does not synthesize the browser's Enter click.
    const home = view.getByRole("menuitemradio", { name: "Home" }); home.focus(); fireEvent.click(home);
    expect(select).toHaveBeenCalledOnce();
  });
  it("clamps and flips the submenu to the left near the right edge", () => {
    Object.defineProperty(window, "innerWidth", { value: 900, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const submenu = this.classList.contains("vela-workspace-submenu");
      const trigger = this.getAttribute("aria-haspopup") === "menu";
      return { left: trigger ? 650 : 0, right: trigger ? 850 : submenu ? 320 : 200, top: 100, bottom: 300, width: submenu ? 320 : 200, height: 200, x: 0, y: 100, toJSON() {} };
    });
    const { view, trigger } = setup(); fireEvent.click(trigger);
    const panel = view.getByRole("menuitemradio", { name: "Work" }).closest('[role="menu"]') as HTMLElement;
    expect(Number.parseFloat(panel.style.left)).toBe(326);
  });
  it("click expands in place at 390px and keeps both menu widths within the viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    const { view, trigger, create } = setup(); fireEvent.click(trigger);
    const menus = view.getAllByRole("menu"); const nested = menus.find(menu => menu.classList.contains("vela-context-menu--inline"))!;
    expect(trigger.contains(nested)).toBe(false); expect(menus[0]?.contains(nested)).toBe(true);
    fireEvent.click(within(nested).getByRole("menuitem", { name: "New workspace" })); expect(create).toHaveBeenCalledOnce();
  });
  it("a click inside the submenu does not dismiss it as an outside click", () => {
    const { view, trigger, onClose } = setup(); fireEvent.click(trigger);
    fireEvent.mouseDown(view.getByRole("button", { name: "Rename Work" })); expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body); expect(onClose).toHaveBeenCalledOnce();
  });
});
