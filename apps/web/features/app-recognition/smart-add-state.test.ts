import { describe, expect, it } from "vitest";

import type { AppRecognitionResult } from "./contract";
import {
  detectedImagePreviewUrl,
  draftFromRecognitionIcon,
  initialSmartAddState,
  smartAddReducer,
  useDetectedIconAvailable,
  useDetectedNameAvailable,
} from "./smart-add-state";

function makeResult(overrides: Partial<AppRecognitionResult> = {}): AppRecognitionResult {
  return {
    normalizedUrl: "https://github.com/",
    hostname: "github.com",
    name: "GitHub",
    nameSource: "brand",
    icon: { kind: "catalog", iconKey: "simple-icons:github", displayName: "GitHub", source: "brand" },
    confidence: "high",
    status: "recognized",
    ...overrides,
  };
}

describe("smartAddReducer recognition application", () => {
  it("an auto result sets both name and icon", () => {
    const state = smartAddReducer(initialSmartAddState(), {
      type: "recognition-succeeded",
      result: makeResult(),
    });
    expect(state.name).toEqual({ value: "GitHub", owner: "auto" });
    expect(state.icon).toEqual({
      value: { kind: "detected-catalog", iconId: "simple-icons:github", displayName: "GitHub" },
      owner: "auto",
    });
    expect(state.recognition).toMatchObject({ status: "ready" });
    expect(state.detected).toEqual({ name: "GitHub", icon: makeResult().icon });
  });

  it("a user-edited name is never overwritten by a later result", () => {
    let state = smartAddReducer(initialSmartAddState(), {
      type: "recognition-succeeded",
      result: makeResult(),
    });
    state = smartAddReducer(state, { type: "edit-name", value: "My Work GitHub" });
    state = smartAddReducer(state, {
      type: "recognition-succeeded",
      result: makeResult({ name: "GitHub Again", icon: { kind: "generated", source: "generated" } }),
    });
    expect(state.name).toEqual({ value: "My Work GitHub", owner: "user" });
    // The icon was still auto → the new suggestion applies.
    expect(state.icon.value).toEqual({ kind: "generated" });
    expect(state.detected?.name).toBe("GitHub Again");
  });

  it("a user-chosen icon is never overwritten by a later result", () => {
    let state = smartAddReducer(initialSmartAddState(), {
      type: "recognition-succeeded",
      result: makeResult(),
    });
    state = smartAddReducer(state, { type: "edit-icon", value: { kind: "library", iconId: "noto:rocket" } });
    state = smartAddReducer(state, {
      type: "recognition-succeeded",
      result: makeResult(),
    });
    expect(state.icon).toEqual({ value: { kind: "library", iconId: "noto:rocket" }, owner: "user" });
    // The name was still auto → refreshed.
    expect(state.name.value).toBe("GitHub");
  });

  it("mixed ownership updates only the auto field", () => {
    let state = smartAddReducer(initialSmartAddState(), { type: "edit-name", value: "Mine" });
    state = smartAddReducer(state, {
      type: "recognition-succeeded",
      result: makeResult({ name: "Auto Name" }),
    });
    expect(state.name).toEqual({ value: "Mine", owner: "user" });
    expect(state.icon.value).toEqual({
      kind: "detected-catalog",
      iconId: "simple-icons:github",
      displayName: "GitHub",
    });

    let other = smartAddReducer(initialSmartAddState(), {
      type: "edit-icon",
      value: { kind: "custom-text", text: "GG" },
    });
    other = smartAddReducer(other, {
      type: "recognition-succeeded",
      result: makeResult({ name: "Auto Name" }),
    });
    expect(other.icon).toEqual({ value: { kind: "custom-text", text: "GG" }, owner: "user" });
    expect(other.name).toEqual({ value: "Auto Name", owner: "auto" });
  });

  it("recognition failure keeps field values and switches the panel to error", () => {
    let state = smartAddReducer(initialSmartAddState(), {
      type: "recognition-succeeded",
      result: makeResult(),
    });
    state = smartAddReducer(state, { type: "recognition-failed", code: "recognition-failed" });
    expect(state.recognition).toEqual({ status: "error", code: "recognition-failed" });
    expect(state.name.value).toBe("GitHub");
    expect(state.detected).not.toBeNull();
  });
});

describe("smartAddReducer use-detected actions", () => {
  it("use-detected-name returns the field to auto with the latest suggestion", () => {
    let state = smartAddReducer(initialSmartAddState(), { type: "edit-name", value: "Mine" });
    state = smartAddReducer(state, {
      type: "recognition-succeeded",
      result: makeResult({ name: "Fresh Suggestion" }),
    });
    expect(useDetectedNameAvailable(state)).toBe(true);
    state = smartAddReducer(state, { type: "use-detected-name" });
    expect(state.name).toEqual({ value: "Fresh Suggestion", owner: "auto" });
    expect(useDetectedNameAvailable(state)).toBe(false);
  });

  it("use-detected-icon returns the field to auto with the latest suggestion", () => {
    let state = smartAddReducer(initialSmartAddState(), {
      type: "edit-icon",
      value: { kind: "custom-text", text: "GG" },
    });
    state = smartAddReducer(state, { type: "recognition-succeeded", result: makeResult() });
    expect(useDetectedIconAvailable(state)).toBe(true);
    state = smartAddReducer(state, { type: "use-detected-icon" });
    expect(state.icon).toEqual({
      value: { kind: "detected-catalog", iconId: "simple-icons:github", displayName: "GitHub" },
      owner: "auto",
    });
    expect(useDetectedIconAvailable(state)).toBe(false);
  });

  it("the actions are no-ops without a suggestion", () => {
    const state = initialSmartAddState();
    expect(smartAddReducer(state, { type: "use-detected-name" })).toBe(state);
    expect(smartAddReducer(state, { type: "use-detected-icon" })).toBe(state);
    expect(useDetectedNameAvailable(state)).toBe(false);
    expect(useDetectedIconAvailable(state)).toBe(false);
  });
});

describe("smartAddReducer url-changed", () => {
  it("flips to waiting on a new recognizable URL and idle on unrecognizable input", () => {
    let state = smartAddReducer(initialSmartAddState(), { type: "url-changed", url: "github.com" });
    expect(state.recognition).toEqual({ status: "waiting" });
    state = smartAddReducer(state, { type: "url-changed", url: "obsidian://note" });
    expect(state.recognition).toEqual({ status: "idle" });
  });

  it("keeps a ready result when the normalized URL is unchanged", () => {
    let state = smartAddReducer(initialSmartAddState(), { type: "url-changed", url: "https://github.com" });
    state = smartAddReducer(state, { type: "recognition-succeeded", result: makeResult() });
    state = smartAddReducer(state, { type: "url-changed", url: "github.com/" });
    expect(state.recognition).toMatchObject({ status: "ready" });
    state = smartAddReducer(state, { type: "url-changed", url: "figma.com" });
    expect(state.recognition).toEqual({ status: "waiting" });
  });

  it("ignores identical input", () => {
    const state = smartAddReducer(initialSmartAddState(), { type: "url-changed", url: "a.com" });
    expect(smartAddReducer(state, { type: "url-changed", url: "a.com" })).toBe(state);
  });
});

describe("draftFromRecognitionIcon + previews", () => {
  it("maps every recognition icon kind", () => {
    expect(draftFromRecognitionIcon({ kind: "generated", source: "generated" })).toEqual({
      kind: "generated",
    });
    expect(
      draftFromRecognitionIcon({
        kind: "embedded-image",
        mimeType: "image/png",
        base64: "AAAA",
        source: "favicon",
      })
    ).toEqual({ kind: "detected-image", mimeType: "image/png", base64: "AAAA" });
  });

  it("embedded previews are local data: URLs only", () => {
    expect(
      detectedImagePreviewUrl({ kind: "detected-image", mimeType: "image/png", base64: "AAAA" })
    ).toBe("data:image/png;base64,AAAA");
    expect(detectedImagePreviewUrl({ kind: "generated" })).toBeNull();
    expect(detectedImagePreviewUrl({ kind: "library", iconId: "simple-icons:github" })).toBeNull();
  });
});
