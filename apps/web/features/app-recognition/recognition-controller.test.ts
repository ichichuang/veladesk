import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRecognitionController } from "./recognition-controller";
import type { AppRecognitionRequestOutcome, RecognitionSend } from "./recognition-client";

interface Deferred {
  resolve: (outcome: AppRecognitionRequestOutcome) => void;
  signal: AbortSignal;
}

function makeResult(name: string): AppRecognitionRequestOutcome {
  return {
    ok: true,
    result: {
      normalizedUrl: `https://${name}.example/`,
      hostname: `${name}.example`,
      name,
      nameSource: "hostname",
      icon: { kind: "generated", source: "generated" },
      confidence: "low",
      status: "partial",
    },
  };
}

function makeHarness() {
  const pending = new Map<number, Deferred>();
  let sendCount = 0;
  const started = vi.fn();
  const outcomes: AppRecognitionRequestOutcome[] = [];
  const send: RecognitionSend = (url, signal) => {
    sendCount += 1;
    const id = sendCount;
    void url;
    return new Promise<AppRecognitionRequestOutcome>((resolve) => {
      pending.set(id, { resolve, signal });
    });
  };
  const controller = new AppRecognitionController(
    { onStarted: started, onOutcome: (outcome) => outcomes.push(outcome) },
    { send }
  );
  return {
    controller,
    get sendCount() {
      return sendCount;
    },
    started,
    outcomes,
    resolve(id: number, outcome: AppRecognitionRequestOutcome) {
      pending.get(id)?.resolve(outcome);
    },
    signalOf(id: number) {
      return pending.get(id)?.signal;
    },
  };
}

describe("AppRecognitionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces: nothing is sent before the delay, exactly one send after", () => {
    const h = makeHarness();
    h.controller.onUrlInput("github.com");
    expect(h.sendCount).toBe(0);
    vi.advanceTimersByTime(399);
    expect(h.sendCount).toBe(0);
    vi.advanceTimersByTime(1);
    expect(h.sendCount).toBe(1);
    expect(h.started).toHaveBeenCalledTimes(1);
  });

  it("rapid typing only fires for the settled value", () => {
    const h = makeHarness();
    h.controller.onUrlInput("g");
    vi.advanceTimersByTime(200);
    h.controller.onUrlInput("gi");
    vi.advanceTimersByTime(200);
    h.controller.onUrlInput("github.com");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(1);
  });

  it("unrecognizable input schedules nothing", () => {
    const h = makeHarness();
    h.controller.onUrlInput("obsidian://note");
    vi.advanceTimersByTime(1000);
    expect(h.sendCount).toBe(0);
    expect(h.started).not.toHaveBeenCalled();
  });

  it("a late response from request A never overwrites request B (§31)", async () => {
    const h = makeHarness();
    h.controller.onUrlInput("a.example");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(1);
    // URL changes to B before A resolves.
    h.controller.onUrlInput("b.example");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(2);
    // A's signal was aborted when B fired.
    expect(h.signalOf(1)?.aborted).toBe(true);
    // B resolves first, A later — only B's outcome may land.
    h.resolve(2, makeResult("b"));
    await vi.advanceTimersByTimeAsync(0);
    h.resolve(1, makeResult("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0]).toMatchObject({ ok: true, result: { name: "b" } });
  });

  it("an aborted request's late callback is ignored", async () => {
    const h = makeHarness();
    h.controller.onUrlInput("a.example");
    vi.advanceTimersByTime(400);
    h.controller.onUrlInput("b.example");
    vi.advanceTimersByTime(400);
    h.resolve(1, makeResult("a")); // stale, resolves after abort
    await vi.advanceTimersByTimeAsync(0);
    expect(h.outcomes).toHaveLength(0);
    h.resolve(2, makeResult("b"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.outcomes).toHaveLength(1);
  });

  it("the same normalized URL does not produce duplicate requests (§32)", () => {
    const h = makeHarness();
    h.controller.onUrlInput("https://github.com");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(1);
    h.resolve(1, makeResult("a"));
    // Rerender / equivalent retype (trailing slash normalizes the same).
    h.controller.onUrlInput("github.com/");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(1);
  });

  it("Recognize again explicitly issues a second request (§29)", () => {
    const h = makeHarness();
    h.controller.onUrlInput("github.com");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(1);
    h.controller.requestAgain();
    expect(h.sendCount).toBe(2);
    expect(h.started).toHaveBeenCalledTimes(2);
    // And the dedupe still holds afterwards.
    h.controller.onUrlInput("github.com");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(2);
  });

  it("a React StrictMode simulated remount (dispose, then input again) still recognizes", () => {
    // React 19 dev StrictMode: mount effects run → cleanups run → the SAME
    // component re-runs its effects. The hook's cleanup disposes the one
    // memoized controller, and the remount effect calls onUrlInput again on
    // that same instance. Recognition must come back to life.
    const h = makeHarness();
    h.controller.onUrlInput(""); // mount effect: empty input
    h.controller.dispose(); // simulated unmount cleanup
    h.controller.onUrlInput(""); // remount effect: still empty
    h.controller.onUrlInput("https://github.com/"); // the user types
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(1);
    expect(h.started).toHaveBeenCalledTimes(1);
  });

  it("Recognize again works after a StrictMode dispose/re-input cycle", () => {
    const h = makeHarness();
    h.controller.onUrlInput("");
    h.controller.dispose();
    h.controller.onUrlInput("github.com");
    vi.advanceTimersByTime(400);
    expect(h.sendCount).toBe(1);
    h.controller.requestAgain();
    expect(h.sendCount).toBe(2);
  });

  it("dispose cancels pending timers and aborts in-flight requests", () => {
    const h = makeHarness();
    h.controller.onUrlInput("a.example");
    vi.advanceTimersByTime(400);
    h.controller.onUrlInput("b.example"); // timer armed, B not yet fired
    h.controller.dispose();
    vi.advanceTimersByTime(1000);
    expect(h.sendCount).toBe(1);
    expect(h.signalOf(1)?.aborted).toBe(true);
    h.resolve(1, makeResult("a"));
    return vi.advanceTimersByTimeAsync(0).then(() => {
      expect(h.outcomes).toHaveLength(0);
    });
  });
});
