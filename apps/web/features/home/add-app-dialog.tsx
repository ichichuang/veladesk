"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AppIcon, AppShortcut, DesktopPageId, EntityId, WorkspaceSnapshot } from "@veladesk/domain";
import { addAppToFolder, addAppToPage } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";
import { ChevronRight } from "lucide-react";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { getBrowserAssetRuntime } from "../assets/browser-assets";
import { normalizeAppRecognitionUrl } from "../app-recognition/normalize-url";
import type { AppRecognitionClientErrorCode } from "../app-recognition/recognition-client";
import {
  initialSmartAddState,
  smartAddReducer,
  useDetectedIconAvailable,
  useDetectedNameAvailable,
} from "../app-recognition/smart-add-state";
import type { AddAppIconDraft, SmartAddState } from "../app-recognition/smart-add-state";
import type { RecognitionIcon } from "../app-recognition/contract";
import { useAppRecognition } from "../app-recognition/use-app-recognition";
import { validateIconText } from "./app-visual-draft";
import { prepareUploadedImage } from "./asset-upload";
import type { UploadValidationIssue } from "./asset-upload";
import { createBrowserId } from "./browser-id";
import { generatedIconText } from "./generated-icon";
import { humanizeIconName } from "./app-icon";
import { IconPreview } from "./icon-picker";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { AddAppIconPickerDialog } from "./add-app-icon-picker";
import { VdFormDialog } from "@components/vd/form-dialog";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { useVdPresence } from "@components/vd/presence";
import { VdAnimatedSurface } from "@components/vd/animated-surface";
import { VdLoadingIndicator } from "@components/vd/loading-indicator";
import "./home-shell.css";

/** Where a newly created app lands: a page layout or directly in a folder. */
export type AddAppDestination =
  | { readonly kind: "page"; readonly pageId: DesktopPageId }
  | { readonly kind: "folder"; readonly folderId: EntityId };

interface AddAppDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly destination: AddAppDestination;
  readonly onClose: () => void;
}

/**
 * Smart Add App (task 020-A): URL-first, with deterministic server-side
 * recognition suggesting name + icon after a short debounce.
 *
 * The recognition state lives in `smartAddReducer` (ephemeral form state,
 * never workspace state); user-owned fields are never overwritten by a
 * late response. Recognition itself causes ZERO revisions — only the Add
 * below persists, through the same single domain op + local-first stage
 * path as before. A detected remote icon becomes a real local asset ONLY
 * on Add: the embedded bytes are validated by the existing upload gate and
 * staged through the existing asset runtime, so the app persists a local
 * asset reference — never a remote URL. Custom-protocol URLs (obsidian://,
 * steam://, …) stay valid exactly as before; they simply never trigger
 * recognition, and are stored verbatim.
 */
export function AddAppDialog({ workspace, destination, onClose }: AddAppDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const [state, dispatch] = useReducer(smartAddReducer, undefined, initialSmartAddState);
  const { recognizeAgain } = useAppRecognition(state.urlInput, dispatch);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Object-URL hygiene: a pending manual upload's preview is revoked when
  // replaced or when the dialog closes. Detected icons preview from data:
  // URLs and need no cleanup.
  const iconValue = state.icon.value;
  useEffect(() => {
    return () => {
      if (iconValue.kind === "pending-upload") {
        URL.revokeObjectURL(iconValue.previewUrl);
      }
    };
  }, [iconValue]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const name = state.name.value;
    if (name.trim().length === 0) {
      setError(t("dialog.addApp.error.enterName"));
      return;
    }
    if (state.urlInput.trim().length === 0) {
      setError(t("dialog.addApp.error.enterUrl"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Recognizable input persists in its normalized https/http form
      // ("github.com" → "https://github.com/"); custom protocols stay
      // verbatim, preserving VelaDesk's launch behavior for them.
      const normalized = normalizeAppRecognitionUrl(state.urlInput);
      const url = normalized.ok ? normalized.normalizedUrl : state.urlInput;

      const icon = await buildPersistedIcon(iconValue, name, t, setError);
      if (icon === undefined) {
        setBusy(false);
        return;
      }

      const app: AppShortcut = {
        kind: "app",
        id: createBrowserId("app"),
        name,
        url,
        icon,
        openMode: "new-tab",
        tags: [],
      };
      const added =
        destination.kind === "page"
          ? addAppToPage(workspace, destination.pageId, app)
          : addAppToFolder(workspace, destination.folderId, app);
      if (!added.ok) {
        setError(describeAddFailure(added.reason, t));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, added.workspace);
      if (!staged.ok) {
        setError(t("dialog.addApp.error.addFailed"));
        setBusy(false);
        return;
      }
      // Icon is visible immediately (local stage); sync is follow-up.
      onClose();
    } catch (dialogError: unknown) {
      setError(
        dialogError instanceof Error ? dialogError.message : t("dialog.addApp.error.exception")
      );
      setBusy(false);
    }
  }

  return (
    <VdFormDialog
      title={t("dialog.addApp.title")}
      submitLabel={busy ? t("dialog.addApp.adding") : t("dialog.addApp.add")}
      busy={busy}
      error={error}
      cancelLabel={t("common.cancel")}
      onCancel={onClose}
      onSubmit={handleSubmit}
    >
      {/* URL is the primary input (020-A §3). */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-vdu-fg" htmlFor="vela-add-app-url">
          {t("dialog.addApp.addressLabel")}
        </label>
        <Input
          id="vela-add-app-url"
          type="text"
          inputMode="url"
          value={state.urlInput}
          maxLength={2048}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder={t("dialog.addApp.addressPlaceholder")}
          onChange={(event) => dispatch({ type: "url-changed", url: event.target.value })}
          aria-describedby={error !== null ? "vela-add-app-error" : undefined}
        />
      </div>

      <RecognitionPanel state={state} onRecognizeAgain={recognizeAgain} />

      {/* Name: auto-suggested, always editable, never focus-stolen. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-vdu-fg" htmlFor="vela-add-app-name">
            {t("dialog.nameLabel")}
          </label>
          {useDetectedNameAvailable(state) ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto px-2 py-1 text-xs"
              onClick={() => dispatch({ type: "use-detected-name" })}
            >
              {t("recognition.useDetectedName")}
            </Button>
          ) : null}
        </div>
        <Input
          id="vela-add-app-name"
          type="text"
          value={state.name.value}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => dispatch({ type: "edit-name", value: event.target.value })}
        />
      </div>

      {/* Icon: one row that opens the focused picker (019-D §9 pattern). */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-vdu-fg">{t("dialog.addApp.iconLabel")}</span>
          {useDetectedIconAvailable(state) ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto px-2 py-1 text-xs"
              onClick={() => dispatch({ type: "use-detected-icon" })}
            >
              {t("recognition.useDetectedIcon")}
            </Button>
          ) : null}
        </div>
        <button type="button" className="vela-inspector__row" onClick={() => setPickerOpen(true)}>
          <AddAppIconThumb value={iconValue} name={state.name.value} />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium text-vdu-fg">
              {describeIconPrimary(iconValue, t)}
            </span>
            <span className="block truncate text-xs text-vdu-fg-muted">
              {describeIconSecondary(iconValue, t)}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-vdu-fg-muted" aria-hidden="true" />
        </button>
      </div>

      {pickerOpen ? (
        <AddAppIconPickerDialog
          value={iconValue}
          name={state.name.value}
          dispatch={dispatch}
          fileInputRef={fileInputRef}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </VdFormDialog>
  );
}

// --- Recognition panel --------------------------------------------------------

/**
 * Quiet, non-focus-stealing status surface (020-A §34–§35): a spinner
 * while recognizing, a summary row when a result lands, and a plain
 * fallback message on error. Recognition statuses are announced politely;
 * hard validation errors keep the dialog-level role="alert".
 */
function RecognitionPanel({
  state,
  onRecognizeAgain,
}: {
  readonly state: SmartAddState;
  readonly onRecognizeAgain: () => void;
}) {
  const { t } = useI18n();
  const recognition = state.recognition;
  const visible =
    recognition.status === "recognizing" ||
    recognition.status === "ready" ||
    recognition.status === "error";
  // Presence (022): the panel plays a short exit when the recognition
  // state clears; the enclosing dialog stays fully interactive.
  const presence = useVdPresence(visible);

  if (!presence.mounted) {
    return null;
  }

  return (
    <VdAnimatedSurface
      variant="recognition"
      active={visible}
      onPresenceReleased={presence.completeExit}
      aria-live="polite"
      className="flex flex-col gap-2 rounded-vdu border border-vdu-border bg-vdu-bg-raised px-3 py-2.5"
      data-vd-recognition-status={recognition.status}
    >
          {recognition.status === "recognizing" ? (
            <div className="flex items-center gap-2 text-xs text-vdu-fg-muted">
              <VdLoadingIndicator size={14} active={true} />
              {t("recognition.status.recognizing")}
            </div>
          ) : recognition.status === "ready" ? (
            <div className="flex items-start gap-2.5">
              <DetectedIconThumb
                icon={state.detected?.icon ?? recognition.result.icon}
                name={recognition.result.name}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-vdu-fg">{recognition.result.name}</p>
                <p className="truncate text-xs text-vdu-fg-muted">{recognition.result.hostname}</p>
                <p className="mt-0.5 text-xs text-vdu-fg-muted">
                  {recognition.result.status === "recognized"
                    ? t("recognition.status.recognized")
                    : `${t("recognition.status.partial")} · ${t("recognition.status.checkDetails")}`}
                </p>
              </div>
              <RecognizeAgainButton onRecognizeAgain={onRecognizeAgain} />
            </div>
          ) : recognition.status === "error" ? (
            <div className="flex items-start justify-between gap-2.5">
              <p className="text-xs leading-relaxed text-vdu-fg-muted">
                {describeRecognitionError(recognition.code, t)}
              </p>
              <RecognizeAgainButton onRecognizeAgain={onRecognizeAgain} />
            </div>
          ) : null}
    </VdAnimatedSurface>
  );
}

function RecognizeAgainButton({ onRecognizeAgain }: { readonly onRecognizeAgain: () => void }) {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto shrink-0 px-2 py-1 text-xs"
      onClick={onRecognizeAgain}
    >
      {t("recognition.again")}
    </Button>
  );
}

// --- Icon previews + labels -----------------------------------------------------

/** The icon row thumbnail: every draft kind previews through existing renderers. */
function AddAppIconThumb({ value, name }: { readonly value: AddAppIconDraft; readonly name: string }) {
  if (value.kind === "pending-upload" || value.kind === "detected-image") {
    const src =
      value.kind === "pending-upload"
        ? value.previewUrl
        : `data:${value.mimeType};base64,${value.base64}`;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local object/data URL of already-fetched bytes, never a remote URL
      <img
        className="vela-inspector__row-thumb"
        src={src}
        alt=""
        draggable={false}
      />
    );
  }
  if (value.kind === "library" || value.kind === "detected-catalog") {
    return (
      <span className="vela-inspector__row-thumb" aria-hidden="true">
        <IconPreview iconId={value.iconId} />
      </span>
    );
  }
  const text = value.kind === "custom-text" ? value.text : generatedIconText(name);
  return (
    <span className="vela-inspector__row-thumb vela-inspector__row-thumb--text" aria-hidden="true">
      {text}
    </span>
  );
}

/** The recognition panel's thumbnail of the DETECTED suggestion. */
function DetectedIconThumb({ icon, name }: { readonly icon: RecognitionIcon; readonly name: string }) {
  if (icon.kind === "embedded-image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local data: URL built from server-fetched bytes; the browser never contacts the remote site
      <img
        className="vela-add-recognition__thumb"
        src={`data:${icon.mimeType};base64,${icon.base64}`}
        alt=""
        draggable={false}
      />
    );
  }
  if (icon.kind === "catalog") {
    return (
      <span className="vela-add-recognition__thumb" aria-hidden="true">
        <IconPreview iconId={icon.iconKey} />
      </span>
    );
  }
  return (
    <span
      className="vela-add-recognition__thumb vela-add-recognition__thumb--text"
      aria-hidden="true"
    >
      {generatedIconText(name)}
    </span>
  );
}

/**
 * Human-readable icon labels (020-A §36): never a technical catalog id.
 */
function describeIconPrimary(value: AddAppIconDraft, t: TranslateFn): string {
  switch (value.kind) {
    case "detected-catalog":
      return value.displayName;
    case "library":
      return value.iconId.length > 0 ? humanizeIconName(value.iconId) : t("visualEditor.changeIcon");
    case "detected-image":
      return t("recognition.iconKind.detected");
    case "pending-upload":
      return t("recognition.iconKind.uploaded");
    case "custom-text":
      return t("recognition.iconKind.customText");
    case "generated":
      return t("recognition.iconKind.auto");
  }
}

function describeIconSecondary(value: AddAppIconDraft, t: TranslateFn): string {
  switch (value.kind) {
    case "detected-catalog":
      return t("recognition.iconKind.catalog");
    case "library":
      return t("visualEditor.tab.library");
    case "detected-image":
    case "pending-upload":
    case "custom-text":
    case "generated":
      return t("visualEditor.changeIcon");
  }
}

// --- Persistence -----------------------------------------------------------------

/**
 * Maps the icon draft onto the persisted `AppIcon`. Remote/manual image
 * bytes go through the EXISTING pipeline on Add only: validate
 * (`prepareUploadedImage`) → stage (`stageAsset`) → local asset
 * reference. Returns undefined (with the error already set) when the
 * bytes fail validation and the add must stop.
 */
async function buildPersistedIcon(
  value: AddAppIconDraft,
  name: string,
  t: TranslateFn,
  setError: (message: string | null) => void
): Promise<AppIcon | undefined> {
  if (value.kind === "library" || value.kind === "detected-catalog") {
    return { kind: "iconify", icon: value.iconId };
  }
  if (value.kind === "custom-text") {
    const issue = validateIconText(value.text);
    if (issue !== undefined) {
      setError(
        issue === "empty"
          ? t("visualEditor.error.enterText")
          : t("visualEditor.error.textTooLong")
      );
      return undefined;
    }
    return { kind: "generated", text: value.text, source: "custom" };
  }
  if (value.kind === "generated") {
    return { kind: "generated", text: generatedIconText(name), source: "auto" };
  }

  // detected-image | pending-upload → existing asset pipeline (016-B).
  let blob: Blob;
  if (value.kind === "detected-image") {
    const bytes = base64ToUint8Array(value.base64);
    const prepared = await prepareUploadedImage(new Blob([bytes], { type: value.mimeType }));
    if (!prepared.ok) {
      setError(describeUploadIssue(prepared.issue, t));
      return undefined;
    }
    blob = prepared.upload.asset.blob;
  } else {
    blob = value.asset.blob;
  }
  const assetRuntime = await getBrowserAssetRuntime();
  const stagedAsset = await assetRuntime.stageAsset(blob);
  if (!stagedAsset.ok) {
    setError(t("visualEditor.error.saveAssetFailed"));
    return undefined;
  }
  return { kind: "asset", assetId: stagedAsset.record.id };
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function describeUploadIssue(issue: UploadValidationIssue, t: TranslateFn): string {
  switch (issue) {
    case "asset-too-large":
      return t("visualEditor.error.tooLarge");
    case "unsupported-image-type":
      return t("visualEditor.error.unsupportedType");
    case "decode-failed":
      return t("visualEditor.error.decodeFailed");
    case "dimensions-too-large":
      return t("visualEditor.error.dimensionsTooLarge");
    case "asset-empty":
      return t("visualEditor.error.decodeFailed");
  }
}

/** Maps client/server recognition error codes to localized copy (§55–§56). */
export function describeRecognitionError(code: AppRecognitionClientErrorCode, t: TranslateFn): string {
  switch (code) {
    case "invalid-url":
    case "credentials-not-allowed":
    case "unsupported-port":
      return t("recognition.error.invalidUrl");
    case "unsupported-protocol":
      return t("recognition.error.unsupportedProtocol");
    case "unsafe-destination":
      return t("recognition.error.unsafeDestination");
    default:
      return t("recognition.status.failed");
  }
}

function describeAddFailure(reason: WorkspaceEditFailureReason, t: TranslateFn): string {
  switch (reason) {
    case "page-not-found":
      return t("dialog.addApp.error.pageGone");
    case "folder-not-found":
      return t("dialog.addApp.error.folderGone");
    case "duplicate-entity-id":
      return t("dialog.addApp.error.duplicate");
    case "no-space":
      return t("dialog.addApp.error.noSpace");
    case "invalid-name":
      return t("dialog.addApp.error.enterName");
    case "invalid-url":
      return t("dialog.addApp.error.enterUrl");
    default:
      return t("dialog.addApp.error.addFailed");
  }
}
