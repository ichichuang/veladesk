"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
  ClipboardEvent as ReactClipboardEvent,
} from "react";
import type { AppShortcut, WorkspaceSnapshot } from "@veladesk/domain";
import {
  MAX_APP_LABEL_SCALE,
  MAX_ICON_SCALE,
  MIN_APP_LABEL_SCALE,
  MIN_ICON_SCALE,
  replaceApp,
} from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";
import type { PreparedAsset } from "@veladesk/assets/core";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { getBrowserAssetRuntime } from "../assets/browser-assets";
import { AppIconTile, appIconDecorationProps } from "./app-icon-renderer";
import { appGlyphColorModel, appVisual, buildAppIconStyleVars } from "./app-icon";
import {
  buildDraftApp,
  decorationStyleChoices,
  draftEquals,
  draftFromApp,
  isDraftSavable,
  validateIconText,
} from "./app-visual-draft";
import type { AppVisualDraft } from "./app-visual-draft";
import { firstClipboardImage, firstImageFile, prepareUploadedImage } from "./asset-upload";
import type { UploadValidationIssue } from "./asset-upload";
import { IconPicker } from "./icon-picker";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import "./home-shell.css";

/**
 * App Visual Editor (task 016-A/016-B, fixed shell in 016-C, per-app
 * presentation in 017-C) — icon source, icon size, label visibility, label
 * size, colors and decoration style for ONE app, opened from the app
 * context menu's "Edit appearance…".
 *
 * The dialog is a FIXED SHELL: the live preview (header) and the
 * Save/Cancel actions (footer) sit outside the one scrolling region, so
 * editing a property at the bottom of the form can never push the preview
 * off screen. The scrolling body is three sections: Icon (source + icon
 * size), Title (show-name switch + title size) and Appearance (decoration
 * + colors). Every size control here edits the INNER presentation — the
 * tile/occupied area stays an Arrange-mode geometry gesture, and the hint
 * in the header says so.
 *
 * The top preview renders the draft through the same AppIconRenderer as
 * the desktop, on a FIXED tile: only the glyph and the name respond to the
 * draft, mirroring the desktop contract that outer geometry never follows
 * presentation. Every change stays in the draft: nothing is staged until
 * Save, and Cancel closes with zero mutation.
 *
 * Upload flow (016-B): a chosen file is validated immediately (size,
 * magic bytes, browser decode, dimension budget) and kept in REACT
 * STATE ONLY — no IndexedDB write, no workspace mutation, no HTTP before
 * Save. Save stages the asset FIRST (content-addressed, so the returned
 * id must equal the draft's), then replaceApp → workspace stage → sync;
 * the sync transport wrapper guarantees the asset PUT precedes the
 * workspace PUT.
 */

interface PendingUpload {
  readonly asset: PreparedAsset;
  readonly previewUrl: string;
}

interface AppVisualEditorProps {
  readonly workspace: WorkspaceSnapshot;
  readonly appId: AppShortcut["id"];
  readonly onClose: () => void;
}

export function AppVisualEditor({ workspace, appId, onClose }: AppVisualEditorProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const existing = workspace.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === appId
  );
  const [draft, setDraft] = useState<AppVisualDraft | undefined>(() =>
    existing === undefined ? undefined : draftFromApp(existing)
  );
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [uploadIssue, setUploadIssue] = useState<UploadValidationIssue | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Focus the shell unless something inside already claimed focus — the
  // icon picker's search field is the first control and focuses itself.
  useEffect(() => {
    const node = dialogRef.current;
    if (node !== null && !node.contains(document.activeElement)) {
      node.focus();
    }
  }, []);

  // Object-URL hygiene: replacing a pending upload revokes the old URL;
  // closing the editor revokes the last one.
  useEffect(() => {
    return () => {
      if (pendingUpload !== null) {
        URL.revokeObjectURL(pendingUpload.previewUrl);
      }
    };
  }, [pendingUpload]);

  if (existing === undefined || draft === undefined) {
    return null;
  }

  const previewApp = buildDraftApp(existing, draft);
  const pristine = draftEquals(draft, draftFromApp(existing));
  const savable = !pristine && isDraftSavable(draft);

  // Patch keys may explicitly pass undefined (Auto colors); the spread
  // overwrites only provided keys, so the assertion is exact at runtime.
  function patch(next: { readonly [K in keyof AppVisualDraft]?: AppVisualDraft[K] | undefined }) {
    setDraft((current) =>
      current === undefined ? current : ({ ...current, ...next } as AppVisualDraft)
    );
  }

  async function acceptImage(blob: Blob) {
    setUploadBusy(true);
    setUploadIssue(null);
    try {
      const prepared = await prepareUploadedImage(blob);
      if (!prepared.ok) {
        setUploadIssue(prepared.issue);
        return;
      }
      // Deterministic draft: same bytes ⇒ same id ⇒ draft equality holds.
      setPendingUpload((current) => {
        if (current !== null) {
          URL.revokeObjectURL(current.previewUrl);
        }
        return { asset: prepared.upload.asset, previewUrl: prepared.upload.previewUrl };
      });
      patch({ source: "upload", assetId: prepared.upload.asset.id });
    } finally {
      setUploadBusy(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files === null) {
      return;
    }
    const file = firstImageFile(files);
    if (file !== undefined) {
      void acceptImage(file);
    }
    event.target.value = "";
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const file = firstImageFile(event.dataTransfer.files);
    if (file !== undefined) {
      void acceptImage(file);
    }
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const image = firstClipboardImage(event.clipboardData);
    if (image !== undefined) {
      event.preventDefault();
      void acceptImage(image);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || existing === undefined || draft === undefined || !savable) {
      return;
    }
    if (draft.source === "text" && draft.textMode === "custom") {
      const issue = validateIconText(draft.customText);
      if (issue === "empty") {
        setError(t("visualEditor.error.enterText"));
        return;
      }
      if (issue === "too-long") {
        setError(t("visualEditor.error.textTooLong"));
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      // Save ordering (016-B): a NEW pending upload is staged into the
      // asset store FIRST, and the staged content id must equal the
      // draft's. Nothing workspace-side happens until the bytes are
      // durably local. An existing asset app without a new file never
      // re-stages.
      if (draft.source === "upload" && pendingUpload !== null) {
        const assetRuntime = await getBrowserAssetRuntime();
        const stagedAsset = await assetRuntime.stageAsset(pendingUpload.asset.blob);
        if (!stagedAsset.ok || stagedAsset.record.id !== draft.assetId) {
          setError(t("visualEditor.error.saveAssetFailed"));
          setBusy(false);
          return;
        }
      }
      const nextApp = buildDraftApp(existing, draft);
      const result = replaceApp(workspace, nextApp);
      if (!result.ok) {
        setError(describeEditFailure(result.reason, t));
        setBusy(false);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
      if (!staged.ok) {
        setError(t("dialog.editApp.error.saveFailed"));
        setBusy(false);
        return;
      }
      onClose();
    } catch (editorError: unknown) {
      setError(
        editorError instanceof Error ? editorError.message : t("dialog.editApp.error.exception")
      );
      setBusy(false);
    }
  }

  function describeUploadIssue(issue: UploadValidationIssue): string {
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

  const uploadSelected = draft.source === "upload" && draft.assetId.length > 0;
  /**
   * Whether the icon still follows the app's foreground color. Multicolor
   * library icons and uploaded images keep their own pigments, so the
   * control is replaced by a note — the persisted color is NOT dropped, it
   * simply has no effect until the user switches back to a tinted source.
   */
  const showForegroundControl = appGlyphColorModel(previewApp) === "tinted";

  return (
    <div
      className="vela-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="vela-dialog vela-visual-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vela-visual-editor-title"
      >
        <form className="vela-visual-editor__form" onSubmit={handleSubmit}>
          {/* Fixed header: the live preview never scrolls away. */}
          <header className="vela-visual-editor__header">
            <h2 id="vela-visual-editor-title" className="vela-dialog__title">
              {t("visualEditor.title", { name: existing.name })}
            </h2>

            {/* Live draft preview — same renderer as the desktop, on a FIXED
                tile (017-C): the presentation vars ride on the preview box so
                glyph AND name react to the draft while the tile itself never
                grows with iconScale. A pending (not yet staged) upload
                previews from its own object URL; everything else goes through
                the shared renderer. */}
            <div
              className="vela-visual-editor__preview"
              data-vd-slot-size="preview"
              style={buildAppIconStyleVars(appVisual(previewApp)) as CSSProperties}
            >
              {draft.source === "upload" && pendingUpload !== null ? (
                <span
                  aria-hidden="true"
                  className="vela-item__icon vela-app-icon"
                  {...appIconDecorationProps(previewApp)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable remote image */}
                  <img
                    className="vela-app-icon__image"
                    src={pendingUpload.previewUrl}
                    alt=""
                    draggable={false}
                  />
                </span>
              ) : (
                <AppIconTile app={previewApp} />
              )}
              {draft.labelVisible ? (
                <span className="vela-visual-editor__preview-name">{existing.name}</span>
              ) : null}
            </div>

            <p className="vela-visual-editor__hint vela-visual-editor__resize-hint">
              {t("visualEditor.resizeHint")}
            </p>
          </header>

          {/* The one scrolling region: three sections — Icon, Title,
              Appearance. Every control edits the draft only. */}
          <div className="vela-visual-editor__body" data-vd-wheel-scope="local">
            <section className="vela-visual-editor__section">
              <h3 className="vela-visual-editor__section-title">
                {t("visualEditor.section.icon")}
              </h3>
              <div
                className="vela-visual-editor__tabs"
                role="tablist"
                aria-label={t("visualEditor.sourceLabel")}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.source === "library"}
                  className="vela-visual-editor__tab"
                  onClick={() => patch({ source: "library" })}
                >
                  {t("visualEditor.tab.library")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.source === "text"}
                  className="vela-visual-editor__tab"
                  onClick={() => patch({ source: "text" })}
                >
                  {t("visualEditor.tab.text")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.source === "upload"}
                  className="vela-visual-editor__tab"
                  onClick={() => patch({ source: "upload" })}
                >
                  {t("visualEditor.tab.upload")}
                </button>
              </div>

              {draft.source === "library" ? (
                <IconPicker
                  selectedId={draft.libraryIcon.length > 0 ? draft.libraryIcon : null}
                  onSelect={(iconId) => patch({ libraryIcon: iconId })}
                />
              ) : draft.source === "upload" ? (
                <div className="vela-visual-editor__upload">
                  <div
                    className="vela-upload-dropzone"
                    data-busy={uploadBusy ? "true" : undefined}
                    tabIndex={0}
                    role="button"
                    aria-label={t("visualEditor.upload.dropHere")}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                    onPaste={handlePaste}
                  >
                    {pendingUpload !== null ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable remote image */}
                        <img
                          className="vela-upload-dropzone__preview"
                          src={pendingUpload.previewUrl}
                          alt=""
                          draggable={false}
                        />
                      </>
                    ) : (
                      <span className="vela-upload-dropzone__hint">
                        {uploadSelected
                          ? t("visualEditor.upload.replaceHint")
                          : t("visualEditor.upload.dropHere")}
                      </span>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="vela-upload-input"
                    accept=".png,.jpg,.jpeg,.webp,.avif,image/png,image/jpeg,image/webp,image/avif"
                    onChange={handleFileChange}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  {uploadIssue !== null ? (
                    <p className="vela-form__error" role="alert">
                      {describeUploadIssue(uploadIssue)}
                    </p>
                  ) : null}
                  <p className="vela-visual-editor__hint">{t("visualEditor.upload.hint")}</p>
                </div>
              ) : (
                <div className="vela-visual-editor__text">
                  <label className="vela-form__label" htmlFor="vela-visual-text-mode">
                    {t("visualEditor.textModeLabel")}
                  </label>
                  <select
                    id="vela-visual-text-mode"
                    className="vela-input"
                    value={draft.textMode}
                    onChange={(event) =>
                      patch({ textMode: event.target.value === "custom" ? "custom" : "auto" })
                    }
                  >
                    <option value="auto">{t("visualEditor.textMode.auto")}</option>
                    <option value="custom">{t("visualEditor.textMode.custom")}</option>
                  </select>
                  {draft.textMode === "custom" ? (
                    <>
                      <label className="vela-form__label" htmlFor="vela-visual-text">
                        {t("visualEditor.customTextLabel")}
                      </label>
                      <input
                        id="vela-visual-text"
                        className="vela-input"
                        type="text"
                        value={draft.customText}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t("visualEditor.customTextPlaceholder")}
                        onChange={(event) => patch({ customText: event.target.value })}
                      />
                      <p className="vela-visual-editor__hint">{t("visualEditor.customTextHint")}</p>
                    </>
                  ) : (
                    <p className="vela-visual-editor__hint">
                      {t("visualEditor.textAutoHint", {
                        text: previewApp.icon.kind === "generated" ? previewApp.icon.text : "",
                      })}
                    </p>
                  )}
                </div>
              )}

              {/* Icon size (017-C): the INNER glyph multiplier. This is not
                  the tile size — placement geometry is Arrange-mode only. */}
              <div className="vela-visual-editor__control">
                <label className="vela-form__label" htmlFor="vela-visual-icon-scale">
                  {t("visualEditor.iconSize")}
                </label>
                <div className="vela-visual-editor__scale-row">
                  <input
                    id="vela-visual-icon-scale"
                    className="vela-visual-editor__range"
                    type="range"
                    min={MIN_ICON_SCALE}
                    max={MAX_ICON_SCALE}
                    step={0.05}
                    value={draft.iconScale}
                    aria-valuetext={scalePercentText(draft.iconScale)}
                    onChange={(event) => patch({ iconScale: Number(event.target.value) })}
                  />
                  <span className="vela-visual-editor__range-value">
                    {scalePercentText(draft.iconScale)}
                  </span>
                </div>
              </div>
            </section>

            <section className="vela-visual-editor__section">
              <h3 className="vela-visual-editor__section-title">
                {t("visualEditor.section.title")}
              </h3>
              <div className="vela-visual-editor__switch-row">
                <label className="vela-form__label" htmlFor="vela-visual-label-visible">
                  {t("visualEditor.labelVisible")}
                </label>
                <input
                  id="vela-visual-label-visible"
                  className="vela-visual-editor__switch"
                  type="checkbox"
                  role="switch"
                  checked={draft.labelVisible}
                  onChange={(event) => patch({ labelVisible: event.target.checked })}
                />
              </div>
              {/* Hiding the name keeps the stored scale: re-enabling restores
                  it, and the control reads disabled rather than resetting. */}
              <div
                className="vela-visual-editor__control"
                data-disabled={draft.labelVisible ? undefined : "true"}
              >
                <label className="vela-form__label" htmlFor="vela-visual-label-scale">
                  {t("visualEditor.labelSize")}
                </label>
                <div className="vela-visual-editor__scale-row">
                  <input
                    id="vela-visual-label-scale"
                    className="vela-visual-editor__range"
                    type="range"
                    min={MIN_APP_LABEL_SCALE}
                    max={MAX_APP_LABEL_SCALE}
                    step={0.05}
                    value={draft.labelScale}
                    disabled={!draft.labelVisible}
                    aria-valuetext={scalePercentText(draft.labelScale)}
                    onChange={(event) => patch({ labelScale: Number(event.target.value) })}
                  />
                  <span className="vela-visual-editor__range-value">
                    {scalePercentText(draft.labelScale)}
                  </span>
                </div>
              </div>
            </section>

            <section className="vela-visual-editor__section">
              <h3 className="vela-visual-editor__section-title">
                {t("visualEditor.section.appearance")}
              </h3>
              <span className="vela-form__label">{t("visualEditor.decorationStyle")}</span>
              <div className="vela-visual-editor__decorations">
                {decorationStyleChoices().map((style) => (
                  <button
                    key={style}
                    type="button"
                    className="vela-visual-editor__decoration"
                    data-style={style}
                    data-selected={draft.decorationStyle === style ? "true" : undefined}
                    aria-pressed={draft.decorationStyle === style}
                    onClick={() => patch({ decorationStyle: style })}
                  >
                    <span className="vela-visual-editor__decoration-tile" data-style={style} />
                    <span>{decorationStyleLabel(style, t)}</span>
                  </button>
                ))}
              </div>

              {showForegroundControl ? (
                <ColorRow
                  label={t("visualEditor.foregroundColor")}
                  autoLabel={t("visualEditor.autoColor")}
                  value={draft.foregroundColor}
                  onChange={(value) => patch({ foregroundColor: value })}
                />
              ) : (
                <p className="vela-visual-editor__hint">
                  {draft.source === "upload"
                    ? t("visualEditor.upload.originalColorNote")
                    : t("visualEditor.originalColorNote")}
                </p>
              )}
              <ColorRow
                label={t("visualEditor.decorationColor")}
                autoLabel={t("visualEditor.autoColor")}
                value={draft.decorationColor}
                onChange={(value) => patch({ decorationColor: value })}
              />
            </section>

            {error !== null ? (
              <p className="vela-form__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {/* Fixed footer: Save/Cancel are always reachable. */}
          <div className="vela-visual-editor__footer">
            <button type="button" className="vela-button" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="vela-button vela-button--primary"
              disabled={busy || !savable}
            >
              {busy ? t("dialog.editApp.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Slider readout: the effective percentage, e.g. `100%`. */
function scalePercentText(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function ColorRow({
  label,
  autoLabel,
  value,
  onChange,
}: {
  readonly label: string;
  readonly autoLabel: string;
  readonly value: string | undefined;
  readonly onChange: (value: string | undefined) => void;
}) {
  return (
    <>
      <span className="vela-form__label">{label}</span>
      <div className="vela-visual-editor__color-row">
        <button
          type="button"
          className="vela-button vela-visual-editor__auto"
          data-active={value === undefined ? "true" : undefined}
          onClick={() => onChange(undefined)}
        >
          {autoLabel}
        </button>
        <input
          aria-label={label}
          className="vela-visual-editor__color"
          type="color"
          value={value ?? "#888888"}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </>
  );
}

function decorationStyleLabel(style: AppVisualDraft["decorationStyle"], t: TranslateFn): string {
  switch (style) {
    case "gradient":
      return t("visualEditor.decoration.gradient");
    case "solid":
      return t("visualEditor.decoration.solid");
    case "glass":
      return t("visualEditor.decoration.glass");
    case "none":
      return t("visualEditor.decoration.none");
  }
}

function describeEditFailure(reason: WorkspaceEditFailureReason, t: TranslateFn): string {
  switch (reason) {
    case "app-not-found":
      return t("dialog.editApp.error.appGone");
    case "invalid-name":
    case "invalid-url":
      return t("dialog.editApp.error.saveFailed");
    default:
      return t("dialog.editApp.error.saveFailed");
  }
}
