// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { gsap } from "@components/vd/gsap";
import { vdMotionDuration } from "@components/vd/motion-tokens";
import { WorkspaceDialog } from "./workspace-dialog";
import { OnboardingScreen } from "./onboarding";
import { Dialog, DialogContent, DialogTitle } from "@components/ui/dialog";
import { useState } from "react";
const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("@components/vd/reduced-motion", () => ({ useVdReducedMotion: () => preference.reduced }));
vi.mock("../workspace-runtime/use-workspace-runtime", () => ({ useWorkspaceRuntimeInstance: () => ({}) }));
beforeEach(() => { preference.reduced = false; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const callbacks = { onCreate: vi.fn().mockResolvedValue({ ok: true }), onRename: vi.fn().mockResolvedValue({ ok: true }), onClose: vi.fn() };

describe("workspace dialog and onboarding reduced motion", () => {
  it("template selection interpolates opacity with controlState and unmount kills the tween", () => {
    const view = render(<WorkspaceDialog candidates={[]} {...callbacks} />);
    const selected = view.getByRole("radio", { name: "示例·前端" }).closest("label")!.querySelector<HTMLElement>(".vela-template-selected")!;
    gsap.getTweensOf(selected).forEach(tween => tween.progress(1));
    fireEvent.click(view.getByRole("radio", { name: "示例·前端" }));
    const tween = gsap.getTweensOf(selected)[0]!;
    expect(tween.duration()).toBe(vdMotionDuration("controlState"));
    expect(selected.style.opacity).toBe("0");
    act(() => { tween.progress(1); }); expect(selected.style.opacity).toBe("1");
    view.unmount(); expect(gsap.getTweensOf(selected)).toHaveLength(0); expect(selected.style.opacity).toBe("");
  });
  it("reduced template selection and onboarding do not start tweens", () => {
    preference.reduced = true;
    const to = vi.spyOn(gsap, "to"); const fromTo = vi.spyOn(gsap, "fromTo");
    const view = render(<WorkspaceDialog candidates={[]} {...callbacks} />);
    fireEvent.click(view.getByRole("radio", { name: "示例·前端" }));
    const selected = view.getByRole("radio", { name: "示例·前端" }).closest("label")!.querySelector<HTMLElement>(".vela-template-selected")!;
    expect(selected.style.opacity).toBe("1"); view.unmount();
    render(<OnboardingScreen />);
    expect(to).not.toHaveBeenCalled(); expect(fromTo).not.toHaveBeenCalled();
  });
  it("shared reduced presence unmounts in the close commit", () => {
    preference.reduced = true;
    function ControlledDialog() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Example</DialogTitle><button onClick={() => setOpen(false)}>Close</button></DialogContent></Dialog>;
    }
    const view = render(<ControlledDialog />);
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(view.queryByRole("dialog", { hidden: true })).toBeNull();
  });
  it("window exit owns presence after the shorter scrim has finished", () => {
    const view = render(<WorkspaceDialog candidates={[]} {...callbacks} />);
    const surface = document.querySelector<HTMLElement>('[data-vd-surface="dialog"]')!;
    view.rerender(<WorkspaceDialog candidates={[]} {...callbacks} open={false} />);
    const overlay = document.querySelector<HTMLElement>('[data-vd-surface="overlay"]')!;
    act(() => { gsap.getTweensOf(overlay).forEach(tween => tween.progress(1)); });
    expect(surface.isConnected).toBe(true);
    act(() => { gsap.getTweensOf(surface).forEach(tween => tween.progress(1)); });
    expect(view.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(gsap.getTweensOf(surface)).toHaveLength(0);
  });
});
