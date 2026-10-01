import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP_RECOGNITION_API_PATH } from "./contract";
import { APP_RECOGNITION_DEBOUNCE_MS, AppRecognitionController } from "./recognition-controller";
import { createRecognitionSender } from "./recognition-client";
import {
  initialSmartAddState,
  smartAddReducer,
} from "./smart-add-state";
import type { SmartAddAction, SmartAddState } from "./smart-add-state";

/**
 * ONE integrated test of the WHOLE client recognition chain (task 020-A1
 * §12): the exact production wiring of AddAppDialog + useAppRecognition,
 * minus React — the real reducer, the real controller, the real HTTP
 * client (mocked fetch only). The previous 118 isolated tests all passed
 * while the runtime integration was broken, so this composes every piece
 * and drives it the way the dialog does.
 */

interface RecordedFetch {
  readonly input: string;
  readonly init: RequestInit;
}

interface FetchResponseShape {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

const GITHUB_RECOGNITION_BODY = {
  recognition: {
    normalizedUrl: "https://github.com/",
    hostname: "github.com",
    name: "GitHub",
    nameSource: "brand",
    icon: {
      kind: "catalog",
      iconKey: "simple-icons:github",
      displayName: "GitHub",
      source: "brand",
    },
    confidence: "high",
    status: "recognized",
  },
};

function makeChain() {
  let state: SmartAddState = initialSmartAddState();
  const fetchCalls: RecordedFetch[] = [];
  let respond: () => FetchResponseShape = () => ({
    ok: true,
    status: 200,
    body: GITHUB_RECOGNITION_BODY,
  });

  const send = createRecognitionSender(((input: string, init: RequestInit) => {
    fetchCalls.push({ input, init });
    const current = respond;
    return Promise.resolve({
      ok: current().ok,
      status: current().status,
      json: async () => current().body,
    } as Response);
  }) as unknown as typeof fetch);

  // Exactly what useAppRecognition wires (use-app-recognition.ts).
  const controller = new AppRecognitionController(
    {
      onStarted: () => dispatch({ type: "recognition-started" }),
      onOutcome: (outcome) => {
        if (outcome.ok) {
          dispatch({ type: "recognition-succeeded", result: outcome.result });
        } else {
          dispatch({ type: "recognition-failed", code: outcome.code });
        }
      },
    },
    { send }
  );

  function dispatch(action: SmartAddAction): void {
    state = smartAddReducer(state, action);
  }

  return {
    get state(): SmartAddState {
      return state;
    },
    dispatch,
    controller,
    fetchCalls,
    respondWith(response: FetchResponseShape): void {
      respond = () => response;
    },
  };
}

describe("Smart Add recognition chain (reducer + controller + client)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("https://github.com/ auto-fills name and icon through the whole chain", async () => {
    const chain = makeChain();

    // Mount effect with the initial empty input (no-op, like production).
    chain.controller.onUrlInput(chain.state.urlInput);

    // The dialog's URL onChange dispatches the string value.
    chain.dispatch({ type: "url-changed", url: "https://github.com/" });
    expect(chain.state.urlInput).toBe("https://github.com/");
    expect(chain.state.recognition.status).toBe("waiting");

    // The hook effect hands the new input to the controller.
    chain.controller.onUrlInput(chain.state.urlInput);

    // Debounce: nothing sent before the delay, one request after.
    vi.advanceTimersByTime(APP_RECOGNITION_DEBOUNCE_MS - 1);
    expect(chain.fetchCalls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(chain.state.recognition.status).toBe("recognizing");
    expect(chain.fetchCalls).toHaveLength(1);

    // Request contract: exact route, POST, JSON body { url }.
    const call = chain.fetchCalls[0];
    if (call === undefined) {
      throw new Error("the debounced recognition request never fired");
    }
    expect(call.input).toBe(APP_RECOGNITION_API_PATH);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
    expect(JSON.parse(String(call.init.body))).toEqual({ url: "https://github.com/" });

    // Server responds with the real envelope shape.
    await vi.advanceTimersByTimeAsync(0);

    expect(chain.state.recognition.status).toBe("ready");
    expect(chain.state.name).toEqual({ value: "GitHub", owner: "auto" });
    expect(chain.state.icon.value).toEqual({
      kind: "detected-catalog",
      iconId: "simple-icons:github",
      displayName: "GitHub",
    });
    expect(chain.state.detected).not.toBeNull();
  });

  it("github.com (schemeless) proceeds and normalizes to https", async () => {
    const chain = makeChain();
    chain.controller.onUrlInput(chain.state.urlInput);
    chain.dispatch({ type: "url-changed", url: "github.com" });
    chain.controller.onUrlInput(chain.state.urlInput);
    vi.advanceTimersByTime(APP_RECOGNITION_DEBOUNCE_MS);
    expect(chain.fetchCalls).toHaveLength(1);
    expect(JSON.parse(String(chain.fetchCalls[0]?.init.body))).toEqual({
      url: "https://github.com/",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.state.recognition.status).toBe("ready");
    expect(chain.state.name.value).toBe("GitHub");
  });

  it("React StrictMode dispose/remount in-flight does not kill recognition", async () => {
    // The 020-A1 regression: React 19 dev StrictMode runs mount effects,
    // then cleanups (controller.dispose()), then mount effects again on the
    // SAME memoized instance. The disposed flag must not be terminal.
    const chain = makeChain();
    chain.controller.onUrlInput(chain.state.urlInput); // mount effect
    chain.controller.dispose(); // StrictMode cleanup
    chain.controller.onUrlInput(chain.state.urlInput); // remount effect

    chain.dispatch({ type: "url-changed", url: "https://github.com/" });
    chain.controller.onUrlInput(chain.state.urlInput);
    vi.advanceTimersByTime(APP_RECOGNITION_DEBOUNCE_MS);

    expect(chain.fetchCalls).toHaveLength(1);
    chain.respondWith({
      ok: true,
      status: 200,
      body: GITHUB_RECOGNITION_BODY,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.state.recognition.status).toBe("ready");
    expect(chain.state.name.value).toBe("GitHub");
  });

  it("a failed response surfaces the error status the panel renders", async () => {
    const chain = makeChain();
    chain.controller.onUrlInput(chain.state.urlInput);
    chain.dispatch({ type: "url-changed", url: "https://github.com/" });
    chain.controller.onUrlInput(chain.state.urlInput);
    chain.respondWith({
      ok: false,
      status: 500,
      body: { error: { code: "recognition-failed" } },
    });
    vi.advanceTimersByTime(APP_RECOGNITION_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.state.recognition).toEqual({
      status: "error",
      code: "recognition-failed",
    });
  });

  it("a manual name edit stays user-owned when the result lands", async () => {
    const chain = makeChain();
    chain.controller.onUrlInput(chain.state.urlInput);
    chain.dispatch({ type: "url-changed", url: "https://github.com/" });
    chain.dispatch({ type: "edit-name", value: "My Hub" });
    chain.controller.onUrlInput(chain.state.urlInput);
    vi.advanceTimersByTime(APP_RECOGNITION_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.state.recognition.status).toBe("ready");
    expect(chain.state.name).toEqual({ value: "My Hub", owner: "user" });
    // Icon is still auto, so it takes the suggestion.
    expect(chain.state.icon.value.kind).toBe("detected-catalog");
  });
});
