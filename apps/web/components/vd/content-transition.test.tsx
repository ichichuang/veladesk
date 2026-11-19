// @vitest-environment jsdom
/*
 * Task 022/t171 — VdTabCrossfade contracts: a tab switch holds the outgoing
 * panel as an inert overlay while the incoming one fades in, then releases
 * it; re-renders that do NOT switch tabs never start a transition.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

import { VdTabCrossfade } from "./content-transition";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VdTabCrossfade", () => {
  it("holds the outgoing panel through the transition, then unmounts it", async () => {
    const view = render(
      <VdTabCrossfade tabKey="library" direction={1}>
        <div>library panel</div>
      </VdTabCrossfade>
    );
    expect(view.getByText("library panel")).toBeTruthy();

    view.rerender(
      <VdTabCrossfade tabKey="text" direction={1}>
        <div>text panel</div>
      </VdTabCrossfade>
    );
    // The incoming panel is live; the outgoing snapshot rides above it,
    // hidden from the accessibility tree and inert to pointers.
    expect(view.getByText("text panel")).toBeTruthy();
    const leaving = view.getByText("library panel").parentElement!;
    expect(leaving.getAttribute("aria-hidden")).toBe("true");
    // F6: inert blocks a cloned panel's mount autofocus from landing inside
    // the hidden layer (passive effects run after any commit-time blur).
    expect(leaving.hasAttribute("inert")).toBe(true);
    expect(leaving.className).toContain("pointer-events-none");
    // After the 200ms crossfade (+ slack) the snapshot is gone.
    await waitFor(() => expect(view.queryByText("library panel")).toBeNull(), {
      timeout: 2000,
    });
  });

  it("does not start a transition when the tab stays and only the content edits", async () => {
    const view = render(
      <VdTabCrossfade tabKey="library" direction={1}>
        <div>{`query: a`}</div>
      </VdTabCrossfade>
    );
    view.rerender(
      <VdTabCrossfade tabKey="library" direction={1}>
        <div>{`query: ab`}</div>
      </VdTabCrossfade>
    );
    // Wait past the transition window: the old content never appears as a
    // leaving overlay.
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(view.getByText("query: ab")).toBeTruthy();
    expect(view.queryByText("query: a")).toBeNull();
  });

  it("releases focus carried into the aria-hidden leaving layer (F6)", async () => {
    const view = render(
      <VdTabCrossfade tabKey="library" direction={1}>
        <div>
          <input aria-label="library search" />
        </div>
      </VdTabCrossfade>
    );
    const field = view.getByLabelText("library search") as HTMLInputElement;
    field.focus();
    expect(document.activeElement).toBe(field);

    // The switch MOVES the outgoing DOM (focus and all) under the
    // aria-hidden snapshot — the layout effect must hand focus back.
    view.rerender(
      <VdTabCrossfade tabKey="text" direction={1}>
        <div>text panel</div>
      </VdTabCrossfade>
    );
    expect(document.activeElement).not.toBe(field);
    expect(document.activeElement).toBe(document.body);
    await waitFor(() => expect(view.queryByLabelText("library search")).toBeNull(), {
      timeout: 2000,
    });
  });
});
