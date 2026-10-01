// @vitest-environment jsdom
/*
 * Task 022 — controlled animated presence: requested-open vs. mounted
 * presence, exactly-one release per exit, and reopen-mid-exit never
 * unmounts. A StrictMode setup-cleanup-setup cycle is exercised directly.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";

import { useVdPresence } from "./presence";

/** Harness: the "exit tween" is a button the test clicks to report completion. */
function Harness({ open }: { open: boolean }) {
  const { mounted, completeExit } = useVdPresence(open);
  return (
    <div data-testid="probe" data-mounted={mounted ? "true" : "false"}>
      {mounted ? (
        <div data-testid="surface">
          <button type="button" data-testid="release" onClick={completeExit} />
          <button
            type="button"
            data-testid="release-twice"
            onClick={() => {
              completeExit();
              completeExit();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("useVdPresence", () => {
  it("mounts immediately when requested open", () => {
    const { getByTestId } = render(<Harness open={true} />);
    expect(getByTestId("probe").dataset.mounted).toBe("true");
    expect(getByTestId("surface")).toBeTruthy();
  });

  it("never mounts when requested closed", () => {
    const { getByTestId, queryByTestId } = render(<Harness open={false} />);
    expect(getByTestId("probe").dataset.mounted).toBe("false");
    expect(queryByTestId("surface")).toBeNull();
  });

  it("keeps presence mounted after a close request until the exit reports completion", () => {
    const view = render(<Harness open={true} />);
    view.rerender(<Harness open={false} />);
    expect(view.getByTestId("probe").dataset.mounted).toBe("true");
    act(() => {
      view.getByTestId("release").click();
    });
    expect(view.getByTestId("probe").dataset.mounted).toBe("false");
  });

  it("a release reported while still requested open is ignored", () => {
    const view = render(<Harness open={true} />);
    act(() => {
      view.getByTestId("release").click();
    });
    expect(view.getByTestId("probe").dataset.mounted).toBe("true");
  });

  it("releases exactly once per exit even if completion fires twice", () => {
    const view = render(<Harness open={true} />);
    view.rerender(<Harness open={false} />);
    act(() => {
      view.getByTestId("release-twice").click();
    });
    expect(view.getByTestId("probe").dataset.mounted).toBe("false");
  });

  it("reopening during an exit cancels the pending release (no unmount, no remount)", () => {
    const surfaces: HTMLElement[] = [];
    function Session({ open }: { open: boolean }) {
      const { mounted, completeExit } = useVdPresence(open);
      return (
        <div data-testid="probe" data-mounted={mounted ? "true" : "false"}>
          {mounted ? (
            <div
              data-testid="surface"
              ref={(node) => {
                if (node !== null) {
                  surfaces.push(node);
                }
              }}
            >
              <button type="button" data-testid="release" onClick={completeExit} />
            </div>
          ) : null}
        </div>
      );
    }
    const view = render(<Session open={true} />);
    const firstSurface = view.getByTestId("surface");
    view.rerender(<Session open={false} />);
    // exit in flight → reopen
    view.rerender(<Session open={true} />);
    // the stale exit completion fires late (the tween was already
    // retargeted; the hook must ignore it)
    act(() => {
      view.getByTestId("release").click();
    });
    expect(view.getByTestId("probe").dataset.mounted).toBe("true");
    expect(view.getByTestId("surface")).toBe(firstSurface);
    // React re-attached the ref on every rerender, but always to the SAME
    // node — the surface never remounted.
    expect(surfaces.every((node) => node === firstSurface)).toBe(true);
  });

  it("survives a StrictMode setup-cleanup-setup cycle while open", () => {
    const { getByTestId } = render(
      <StrictMode>
        <Harness open={true} />
      </StrictMode>
    );
    expect(getByTestId("probe").dataset.mounted).toBe("true");
  });
});
