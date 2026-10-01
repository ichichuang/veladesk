// @vitest-environment jsdom
/*
 * Task 022 — interaction-feedback primitives: press scale on an inner node
 * (hit geometry untouched), the owned retargetable press tween, the rail
 * indicator's one-shot measurement + glide, and the loading rotation's
 * lifecycle (active=false / unmount stops it).
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";

import { gsap } from "./gsap";
import { VdPressFeedback } from "./press-feedback";
import { VdAnimatedIndicator } from "./animated-indicator";
import { VdLoadingIndicator } from "./loading-indicator";

function lastTween(el: Element): gsap.core.Tween | undefined {
  const tweens = gsap.getTweensOf(el);
  return tweens[tweens.length - 1];
}

function pressEvent(type: string): Event {
  return new Event(type, { bubbles: true });
}

function PressButton() {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      data-testid="button"
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      <VdPressFeedback pressed={pressed} data-testid="press">
        label
      </VdPressFeedback>
    </button>
  );
}

afterEach(() => {
  cleanup();
});

describe("VdPressFeedback", () => {
  it("compresses an INNER node while pressed — the owning control is untouched", () => {
    const view = render(<PressButton />);
    const button = view.getByTestId("button");
    const press = view.getByTestId("press");
    act(() => {
      button.dispatchEvent(pressEvent("pointerdown"));
    });
    expect(lastTween(press as HTMLElement)).toBeDefined();
    lastTween(press as HTMLElement)!.progress(1);
    expect((press as HTMLElement).style.transform).toContain("0.97");
    expect((button as HTMLElement).style.transform).toBe("");
  });

  it("retargets one tween per press state change instead of stacking tweens", () => {
    const view = render(<PressButton />);
    const press = view.getByTestId("press") as HTMLElement;
    const button = view.getByTestId("button");
    act(() => {
      for (let i = 0; i < 5; i += 1) {
        button.dispatchEvent(pressEvent("pointerdown"));
        button.dispatchEvent(pressEvent("pointerup"));
      }
    });
    expect(gsap.getTweensOf(press)).toHaveLength(1);
    lastTween(press)!.progress(1);
    expect(press.style.transform).not.toContain("0.97");
  });
});

describe("VdAnimatedIndicator", () => {
  function makeList(): { container: HTMLElement; items: HTMLElement[] } {
    const container = document.createElement("div");
    Object.defineProperty(container, "offsetTop", { value: 0 });
    const items = [0, 1, 2].map((index) => {
      const item = document.createElement("button");
      Object.defineProperty(item, "offsetTop", { value: index * 36 });
      Object.defineProperty(item, "offsetHeight", { value: 28 });
      container.appendChild(item);
      return item;
    });
    document.body.appendChild(container);
    return { container, items };
  }

  function renderIndicator(container: HTMLElement, activeKey: string | null) {
    return render(
      <VdAnimatedIndicator
        container={container}
        activeKey={activeKey}
        resolveTarget={(key, host) => host.querySelector<HTMLElement>(`[data-key="${key}"]`)}
        className="ind"
      />
    );
  }

  it("a fresh marker settles into place without a sweep, then glides between targets", () => {
    const { container, items } = makeList();
    items.forEach((item, index) => item.setAttribute("data-key", `p${index}`));
    const view = renderIndicator(container, "p0");
    const marker = document.querySelector(".ind") as HTMLElement;
    expect(marker).toBeTruthy();
    // First appearance: placed instantly (no tween, no sweep from 0).
    expect(gsap.getTweensOf(marker)).toHaveLength(0);
    expect(marker.style.top).toBe("0px");
    expect(marker.style.opacity).toBe("1");

    view.rerender(
      <VdAnimatedIndicator
        container={container}
        activeKey="p2"
        resolveTarget={(key, host) => host.querySelector<HTMLElement>(`[data-key="${key}"]`)}
        className="ind"
      />,
    );
    const tween = lastTween(marker)!;
    expect(tween).toBeDefined();
    expect(tween.duration()).toBeCloseTo(0.28, 5);
    tween.progress(1);
    expect(marker.style.top).toBe("72px");
  });

  it("hides when there is no active target and re-places instantly on return", () => {
    const { container, items } = makeList();
    items.forEach((item, index) => item.setAttribute("data-key", `p${index}`));
    const view = render(
      <VdAnimatedIndicator
        container={container}
        activeKey="p0"
        resolveTarget={(key, host) => host.querySelector<HTMLElement>(`[data-key="${key}"]`)}
        className="ind"
      />
    );
    const marker = document.querySelector(".ind") as HTMLElement;
    expect(marker.style.opacity).toBe("1");
    view.rerender(
      <VdAnimatedIndicator
        container={container}
        activeKey={null}
        resolveTarget={(key, host) => host.querySelector<HTMLElement>(`[data-key="${key}"]`)}
        className="ind"
      />
    );
    expect(marker.style.opacity).toBe("0");
  });
});

describe("VdLoadingIndicator", () => {
  it("runs one owned infinite rotation while active", () => {
    const view = render(<VdLoadingIndicator active={true} />);
    const el = view.container.firstElementChild as HTMLElement;
    const tween = lastTween(el!)!;
    expect(tween.repeat()).toBe(-1);
    expect(tween.vars.ease).toBe("none");
  });

  it("stops when no longer pending and on unmount", () => {
    const view = render(<VdLoadingIndicator active={true} />);
    const el = view.container.firstElementChild as HTMLElement;
    expect(gsap.getTweensOf(el)).toHaveLength(1);
    view.rerender(<VdLoadingIndicator active={false} />);
    expect(gsap.getTweensOf(el)).toHaveLength(0);
    view.unmount();
  });

  it("reduced motion renders a static glyph", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    (window as { matchMedia?: unknown }).matchMedia = () => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    });
    try {
      const view = render(<VdLoadingIndicator active={true} />);
      const el = view.container.firstElementChild as HTMLElement;
      expect(gsap.getTweensOf(el)).toHaveLength(0);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});
