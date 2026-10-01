/**
 * Smart Add-App form state (task 020-A §26–§29).
 *
 * EPHEMERAL Add-App dialog state — nothing here persists into the
 * workspace. The one hard rule: a field owned by "user" is NEVER
 * overwritten by a recognition response, no matter how late it arrives;
 * only the explicit "Use detected …" actions hand control back to auto.
 */

import type { PreparedAsset } from "@veladesk/assets/core";

import type { AppRecognitionResult, RecognitionIcon } from "./contract";
import { normalizeAppRecognitionUrl } from "./normalize-url";
import type { AppRecognitionClientErrorCode } from "./recognition-client";

export type FieldOwner = "auto" | "user";

/**
 * The icon the Add-App form currently stands for. `detected-*` values come
 * from recognition (auto); `library` / `pending-upload` / `custom-text`
 * come from the manual picker (user); `generated` is the plain
 * initials-follow-name default. A pending manual upload carries the
 * PreparedAsset so its bytes exist only in memory until Add stages them —
 * Cancel never persists anything.
 */
export type AddAppIconDraft =
  | { readonly kind: "generated" }
  | { readonly kind: "custom-text"; readonly text: string }
  | { readonly kind: "library"; readonly iconId: string }
  | { readonly kind: "detected-catalog"; readonly iconId: string; readonly displayName: string }
  | { readonly kind: "detected-image"; readonly mimeType: string; readonly base64: string }
  | { readonly kind: "pending-upload"; readonly asset: PreparedAsset; readonly previewUrl: string };

export type SmartAddRecognitionStatus =
  | { readonly status: "idle" }
  | { readonly status: "waiting" }
  | { readonly status: "recognizing" }
  | { readonly status: "ready"; readonly result: AppRecognitionResult }
  | { readonly status: "error"; readonly code: AppRecognitionClientErrorCode };

export interface SmartAddState {
  readonly urlInput: string;
  readonly recognition: SmartAddRecognitionStatus;
  readonly name: { readonly value: string; readonly owner: FieldOwner };
  readonly icon: { readonly value: AddAppIconDraft; readonly owner: FieldOwner };
  /** The latest accepted suggestion, powering the "Use detected …" actions. */
  readonly detected: { readonly name: string; readonly icon: RecognitionIcon } | null;
}

export type SmartAddAction =
  | { readonly type: "url-changed"; readonly url: string }
  | { readonly type: "recognition-started" }
  | { readonly type: "recognition-succeeded"; readonly result: AppRecognitionResult }
  | { readonly type: "recognition-failed"; readonly code: AppRecognitionClientErrorCode }
  | { readonly type: "edit-name"; readonly value: string }
  | { readonly type: "edit-icon"; readonly value: AddAppIconDraft }
  | { readonly type: "use-detected-name" }
  | { readonly type: "use-detected-icon" };

export function initialSmartAddState(): SmartAddState {
  return {
    urlInput: "",
    recognition: { status: "idle" },
    name: { value: "", owner: "auto" },
    icon: { value: { kind: "generated" }, owner: "auto" },
    detected: null,
  };
}

export function smartAddReducer(state: SmartAddState, action: SmartAddAction): SmartAddState {
  switch (action.type) {
    case "url-changed": {
      if (action.url === state.urlInput) {
        return state;
      }
      return { ...state, urlInput: action.url, recognition: nextStatusForUrl(action.url, state) };
    }
    case "recognition-started":
      return { ...state, recognition: { status: "recognizing" } };
    case "recognition-succeeded": {
      const { result } = action;
      return {
        ...state,
        recognition: { status: "ready", result },
        name:
          state.name.owner === "auto"
            ? { value: result.name, owner: "auto" }
            : state.name,
        icon:
          state.icon.owner === "auto"
            ? { value: draftFromRecognitionIcon(result.icon), owner: "auto" }
            : state.icon,
        detected: { name: result.name, icon: result.icon },
      };
    }
    case "recognition-failed":
      return { ...state, recognition: { status: "error", code: action.code } };
    case "edit-name":
      return { ...state, name: { value: action.value, owner: "user" } };
    case "edit-icon":
      return { ...state, icon: { value: action.value, owner: "user" } };
    case "use-detected-name":
      if (state.detected === null) {
        return state;
      }
      return { ...state, name: { value: state.detected.name, owner: "auto" } };
    case "use-detected-icon":
      if (state.detected === null) {
        return state;
      }
      return { ...state, icon: { value: draftFromRecognitionIcon(state.detected.icon), owner: "auto" } };
  }
}

/**
 * A URL edit flips the status to `waiting` only when the new normalized
 * URL actually differs from the ready result (re-typing an equivalent URL
 * keeps the panel). Unrecognizable input (custom protocols, mid-typing)
 * goes quiet.
 */
function nextStatusForUrl(url: string, state: SmartAddState): SmartAddRecognitionStatus {
  const normalized = normalizeAppRecognitionUrl(url);
  if (!normalized.ok) {
    return { status: "idle" };
  }
  if (state.recognition.status === "ready" && state.recognition.result.normalizedUrl === normalized.normalizedUrl) {
    return state.recognition;
  }
  return { status: "waiting" };
}

/** The icon draft shapes a recognition suggestion can produce. */
export type RecognitionIconDraft = Extract<
  AddAppIconDraft,
  { readonly kind: "detected-catalog" | "detected-image" | "generated" }
>;

/** Maps a recognition icon suggestion onto the form's icon draft. */
export function draftFromRecognitionIcon(icon: RecognitionIcon): RecognitionIconDraft {
  switch (icon.kind) {
    case "catalog":
      return { kind: "detected-catalog", iconId: icon.iconKey, displayName: icon.displayName };
    case "embedded-image":
      return { kind: "detected-image", mimeType: icon.mimeType, base64: icon.base64 };
    case "generated":
      return { kind: "generated" };
  }
}

/**
 * The local preview URL for an embedded recognized icon — a `data:` URL
 * built from the already-fetched bytes, so the browser NEVER contacts the
 * remote site to display it.
 */
export function detectedImagePreviewUrl(draft: AddAppIconDraft): string | null {
  if (draft.kind !== "detected-image") {
    return null;
  }
  return `data:${draft.mimeType};base64,${draft.base64}`;
}

/** Whether the "Use detected name" action would change anything. */
export function useDetectedNameAvailable(state: SmartAddState): boolean {
  return (
    state.detected !== null &&
    state.name.owner === "user" &&
    state.name.value !== state.detected.name
  );
}

/** Whether the "Use detected icon" action would change anything. */
export function useDetectedIconAvailable(state: SmartAddState): boolean {
  return (
    state.detected !== null &&
    state.icon.owner === "user" &&
    detectedIconDiffers(state.icon.value, state.detected.icon)
  );
}

function detectedIconDiffers(value: AddAppIconDraft, detected: RecognitionIcon): boolean {
  const detectedDraft = draftFromRecognitionIcon(detected);
  switch (detectedDraft.kind) {
    case "detected-catalog":
      return value.kind !== "detected-catalog" || value.iconId !== detectedDraft.iconId;
    case "detected-image":
      return (
        value.kind !== "detected-image" ||
        value.mimeType !== detectedDraft.mimeType ||
        value.base64 !== detectedDraft.base64
      );
    case "generated":
      return value.kind !== "generated";
  }
}
