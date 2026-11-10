import { describe, expect, it } from "vitest";

import { installDndDropSettle } from "./dnd-static-drop";

/**
 * The drop-settle installer contract (Helm r3): the Feedback plugin is
 * identified by its prototype `overlay` accessor — its `dropAnimation`
 * field is DECLARED but never initialized in @dnd-kit/dom 0.5, so the
 * previous `"dropAnimation" in plugin` guard never matched and the default
 * 250ms fly-home animation kept running (the r1/r2 bounce bug).
 */
describe("installDndDropSettle", () => {
  class FakeFeedback {
    dropAnimation?: unknown;
    get overlay(): Element | undefined {
      return undefined;
    }
  }
  class OtherPlugin {
    touch(): void {}
  }

  function makeManager(plugins: readonly object[]) {
    return { plugins } as unknown as Parameters<typeof installDndDropSettle>[0];
  }

  it("assigns the settle function onto the Feedback plugin", () => {
    const feedback = new FakeFeedback();
    const other = new OtherPlugin();
    installDndDropSettle(makeManager([other, feedback]));
    expect(feedback).toHaveProperty("dropAnimation");
    expect(typeof feedback.dropAnimation).toBe("function");
    // Other plugins are untouched — a foreign `dropAnimation` property
    // would be meaningless to them anyway, and the guard must not miss.
    expect(other).not.toHaveProperty("dropAnimation");
  });

  it("skips plugins without the overlay accessor entirely", () => {
    const other = new OtherPlugin();
    installDndDropSettle(makeManager([other, new OtherPlugin()]));
    expect(other).not.toHaveProperty("dropAnimation");
  });
});
