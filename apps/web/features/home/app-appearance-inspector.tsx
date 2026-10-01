"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  Dispatch,
  RefObject,
  SetStateAction,
  DragEvent as ReactDragEvent,
  ClipboardEvent as ReactClipboardEvent,
} from "react";
import type { AppShortcut, WorkspaceSnapshot } from "@veladesk/domain";
import { replaceApp } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";
import type { PreparedAsset } from "@veladesk/assets/core";
import { Button, CloseButton, Input, Label, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { ChevronRight } from "lucide-react";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { getBrowserAssetRuntime } from "../assets/browser-assets";
import { AppIconTile, appIconDecorationProps } from "./app-icon-renderer";
import { appGlyphColorModel, appIconDisplayText, humanizeIconName } from "./app-icon";
import {
  buildDraftApp,
  decorationStyleChoices,
  validateIconText,
} from "./app-visual-draft";
import type { AppVisualDraft } from "./app-visual-draft";
import { isSessionPristine, isSessionSavable } from "./app-appearance-session";
import { firstClipboardImage, firstImageFile, prepareUploadedImage } from "./asset-upload";
import type { UploadValidationIssue } from "./asset-upload";
import { IconPicker, IconPreview } from "./icon-picker";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@components/ui/dialog";
import { VdScrollArea } from "@components/vd/scroll-area";
import { VdSwitch } from "@components/vd/switch";
import { ColorField } from "@components/vd/color-popover";
import "./home-shell.css";

/**
 * App Appearance Inspector (task 019-C, product-grade 019-D) — the REAL
 * desktop is the preview.
 *
 * A fixed right-side panel over the workspace (never a layout sibling, so
 * grid cells, section scroller and freeform geometry cannot reflow). The
 * shell owns the appearance session: this component receives the DRAFT and
 * reports changes upward, and the desktop re-renders the actual placed app
 * through the same canonical projection (`buildDraftApp`) that Save
 * persists — there is no simulated tile, no preview sizing, nothing that
 * can diverge from the real adaptive DesktopItem.
 *
 * Controls are canonical HeroUI components themed through the --vdu-*
 * token bridge; the background-style tiles are custom because they show
 * live previews of the style itself. Technical catalog ids (019-D §9)
 * never appear as the primary icon label — the icon row shows a
 * human-readable name and opens the focused picker.
 *
 * Persistence: ONLY the Save handler below stages anything. Draft changes,
 * cancel and Escape never touch the workspace.
 */

interface PendingUpload {
  readonly asset: PreparedAsset;
  readonly previewUrl: string;
}

export interface AppAppearanceInspectorProps {
  /** Requested visibility; the panel stays mounted through its exit. */
  readonly open: boolean;
  /** The PERSISTED snapshot — the source of truth Save starts from. */
  readonly workspace: WorkspaceSnapshot;
  readonly appId: AppShortcut["id"];
  /** The shell-owned session draft (single source; the picker edits it too). */
  readonly draft: AppVisualDraft;
  readonly onDraftChange: (draft: AppVisualDraft) => void;
  /** Cancel/Escape/close: drop the session, revert to the persisted look. */
  readonly onCancel: () => void;
  /** Save SUCCEEDED: close the panel; the shell runs the zero-bounce handoff. */
  readonly onSaved: () => void;
}

export function AppAppearanceInspector({
  open,
  workspace,
  appId,
  draft,
  onDraftChange,
  onCancel,
  onSaved,
}: AppAppearanceInspectorProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const existing = workspace.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === appId
  );
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Open-driven presence (022): each OPEN transition resets the transient
  // panel state — the same fresh state a remount used to produce.
  const previousOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (open && !wasOpen) {
      setPendingUpload(null);
      setPickerOpen(false);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  // The one projection: what the header identity thumbnail shows, what the
  // desktop renders (via the shell session) and what Save persists.
  const projected =
    existing === undefined ? undefined : buildDraftApp(existing, draft);
  const pristine = existing !== undefined && isSessionPristine(existing, { appId, draft });
  const savable = existing !== undefined && isSessionSavable(existing, { appId, draft });

  // Object-URL hygiene: replacing a pending upload revokes the old URL;
  // closing the inspector revokes the last one.
  useEffect(() => {
    return () => {
      if (pendingUpload !== null) {
        URL.revokeObjectURL(pendingUpload.previewUrl);
      }
    };
  }, [pendingUpload]);

  if (existing === undefined || projected === undefined) {
    return null;
  }

  // Patch keys may explicitly pass undefined (Auto colors); the spread
  // overwrites only provided keys, so the assertion is exact at runtime.
  function patch(next: { readonly [K in keyof AppVisualDraft]?: AppVisualDraft[K] | undefined }) {
    onDraftChange({ ...draft, ...next } as AppVisualDraft);
  }

  async function handleSave() {
    if (busy || !savable) {
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
      onSaved();
    } catch (editorError: unknown) {
      setError(
        editorError instanceof Error ? editorError.message : t("dialog.editApp.error.exception")
      );
      setBusy(false);
    }
  }

  const showForegroundControl = appGlyphColorModel(projected) === "tinted";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent
        variant="panel"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[380px]"
        data-vd-wheel-scope="local"
      >
        {/* Header: app identity thumbnail + name. The thumbnail is an
            identity cue at a fixed slot size — deliberately NOT a preview
            of adaptive desktop composition (019-C §12). */}
        <header className="flex h-[64px] shrink-0 items-center gap-3 border-b border-vdu-border px-5">
          {draft.source === "upload" && pendingUpload !== null ? (
            <span
              aria-hidden="true"
              className="vela-item__icon vela-app-icon"
              {...appIconDecorationProps(projected)}
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
            <AppIconTile app={projected} />
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">{existing.name}</DialogTitle>
            <DialogDescription className="text-xs">
              {t("visualEditor.inspectorSubtitle")}
            </DialogDescription>
          </div>
          <CloseButton aria-label={t("common.close")} className="scale-90 text-vdu-fg-muted" onPress={onCancel} />
        </header>

        {/* Body: flat label/control rows, one independent scroll region
            (VdScrollArea, 021-A owns the overflow). */}
        <VdScrollArea
          axis="y"
          className="flex min-h-0 flex-1 flex-col gap-7 px-5 py-5"
        >
          {/* SECTION — Icon: one row that opens the focused picker. The
              primary label is always human-readable (019-D §9). */}
          <section className="flex flex-col gap-2.5">
            <span className="vela-inspector__section-label">
              {t("visualEditor.section.icon")}
            </span>
            <button
              type="button"
              className="vela-inspector__row"
              onClick={() => setPickerOpen(true)}
            >
              <IconRowThumbnail draft={draft} projected={projected} pendingUpload={pendingUpload} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-vdu-fg">
                  {describeDraftSourcePrimary(draft, projected, t)}
                </span>
                <span className="block truncate text-xs text-vdu-fg-muted">
                  {describeDraftSourceSecondary(draft, t)}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-vdu-fg-muted" aria-hidden="true" />
            </button>
            {draft.source === "text" ? (
              <GeneratedTextControls draft={draft} autoText={autoGeneratedText(projected)} patch={patch} />
            ) : null}
          </section>

          {/* SECTION — Title: the one title control left (019-B). */}
          <section className="flex flex-col gap-2.5">
            <span className="vela-inspector__section-label">
              {t("visualEditor.section.title")}
            </span>
            <div className="flex items-center justify-between gap-6">
              <label
                className="text-sm font-medium text-vdu-fg"
                htmlFor="vela-visual-label-visible"
              >
                {t("visualEditor.labelVisible")}
              </label>
              <VdSwitch
                id="vela-visual-label-visible"
                isSelected={draft.labelVisible}
                onChange={(labelVisible) => patch({ labelVisible })}
                aria-label={t("visualEditor.labelVisible")}
              />
            </div>
          </section>

          {/* SECTION — Appearance */}
          <section className="flex flex-col gap-4">
            <span className="vela-inspector__section-label">
              {t("visualEditor.section.appearance")}
            </span>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-vdu-fg">
                {t("visualEditor.decorationStyle")}
              </span>
              <div className="grid max-w-[320px] grid-cols-4 gap-2">
                {decorationStyleChoices().map((style) => (
                  <button
                    key={style}
                    type="button"
                    className="vela-appearance-inspector__decoration"
                    data-style={style}
                    data-selected={draft.decorationStyle === style ? "true" : undefined}
                    aria-pressed={draft.decorationStyle === style}
                    onClick={() => patch({ decorationStyle: style })}
                  >
                    <span
                      className="vela-appearance-inspector__decoration-tile"
                      data-style={style}
                    />
                    <span>{decorationStyleLabel(style, t)}</span>
                  </button>
                ))}
              </div>
            </div>

            {showForegroundControl ? (
              <ColorSettingRow
                label={t("visualEditor.foregroundColor")}
                autoLabel={t("visualEditor.autoColor")}
                value={draft.foregroundColor}
                onChange={(foregroundColor) => patch({ foregroundColor })}
              />
            ) : (
              <p className="text-xs leading-relaxed text-vdu-fg-muted">
                {draft.source === "upload"
                  ? t("visualEditor.upload.originalColorNote")
                  : t("visualEditor.originalColorNote")}
              </p>
            )}
            <ColorSettingRow
              label={t("visualEditor.decorationColor")}
              autoLabel={t("visualEditor.autoColor")}
              value={draft.decorationColor}
              onChange={(decorationColor) => patch({ decorationColor })}
            />
          </section>

          {error !== null ? (
            <p className="text-xs text-vdu-danger" role="alert">
              {error}
            </p>
          ) : null}
        </VdScrollArea>

        {/* Footer: Cancel reverts; Save persists exactly the projection. */}
        <footer className="flex h-[60px] shrink-0 items-center justify-end gap-2.5 border-t border-vdu-border px-5">
          <Button variant="ghost" onPress={onCancel} isDisabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onPress={() => void handleSave()} isDisabled={busy || pristine || !savable}>
            {busy ? t("dialog.editApp.saving") : t("common.save")}
          </Button>
        </footer>
      </DialogContent>

      {pickerOpen ? (
        <AppearanceIconPickerDialog
          draft={draft}
          projected={projected}
          onDraftChange={onDraftChange}
          pendingUpload={pendingUpload}
          onPendingUploadChange={setPendingUpload}
          fileInputRef={fileInputRef}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

/**
 * The secondary icon picker (019-C §9, refined 019-D §10): source mode
 * (Library / Text / Upload), the BOUNDED icon grid behind a sticky search
 * area, upload affordance and generated-text controls. Selection applies
 * to the shared draft IMMEDIATELY — the real desktop tile changes live —
 * and a library pick closes the picker back into the inspector. No
 * appearance/decoration controls are duplicated here.
 */
function AppearanceIconPickerDialog({
  draft,
  projected,
  onDraftChange,
  pendingUpload,
  onPendingUploadChange,
  fileInputRef,
  onClose,
}: {
  readonly draft: AppVisualDraft;
  readonly projected: AppShortcut;
  readonly onDraftChange: (draft: AppVisualDraft) => void;
  readonly pendingUpload: PendingUpload | null;
  readonly onPendingUploadChange: Dispatch<SetStateAction<PendingUpload | null>>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const [uploadIssue, setUploadIssue] = useState<UploadValidationIssue | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  function patch(next: { readonly [K in keyof AppVisualDraft]?: AppVisualDraft[K] | undefined }) {
    onDraftChange({ ...draft, ...next } as AppVisualDraft);
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
      onPendingUploadChange((current) => {
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

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        showCloseButton
        motionPreset="picker"
        aria-describedby={undefined}
        className="h-[560px] max-h-[calc(100dvh-32px)] w-[600px] max-w-[calc(100vw-32px)]"
        data-vd-wheel-scope="local"
      >
        <header className="flex h-[54px] shrink-0 items-center border-b border-vdu-border px-5">
          <DialogTitle className="truncate text-base">
            {t("visualEditor.changeIcon")}
          </DialogTitle>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Source mode — a designed segmented control, never a native
              select. */}
          <div className="shrink-0 px-5 pt-4">
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={new Set([draft.source])}
              onSelectionChange={(keys) => {
                const value = [...keys][0];
                if (value === "library" || value === "text" || value === "upload") {
                  patch({ source: value });
                }
              }}
              aria-label={t("visualEditor.sourceLabel")}
            >
              <ToggleButton id="library">{t("visualEditor.tab.library")}</ToggleButton>
              <ToggleButton id="text">{t("visualEditor.tab.text")}</ToggleButton>
              <ToggleButton id="upload">{t("visualEditor.tab.upload")}</ToggleButton>
            </ToggleButtonGroup>
          </div>

          {draft.source === "library" ? (
            <div className="vela-visual-editor__picker-bound flex min-h-0 flex-1 flex-col">
              <IconPicker
                selectedId={draft.libraryIcon.length > 0 ? draft.libraryIcon : null}
                onSelect={(iconId) => {
                  patch({ libraryIcon: iconId });
                  onClose();
                }}
              />
            </div>
          ) : draft.source === "upload" ? (
            <VdScrollArea
              axis="y"
              className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4"
            >
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
                    {draft.assetId.length > 0
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
                <p className="text-xs text-vdu-danger" role="alert">
                  {describeUploadIssue(uploadIssue, t)}
                </p>
              ) : null}
              <p className="text-xs leading-relaxed text-vdu-fg-muted">
                {t("visualEditor.upload.hint")}
              </p>
            </VdScrollArea>
          ) : (
            <VdScrollArea
              axis="y"
              className="flex min-h-0 flex-1 flex-col px-5 py-4"
            >
              <GeneratedTextControls draft={draft} autoText={autoGeneratedText(projected)} patch={patch} withHints />
            </VdScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Generated/custom text controls — shared by the inspector and the picker.
 * Canonical HeroUI controls only (019-D §21 forbids the browser-native
 * select/checkbox/range/color trio on this surface).
 */
function GeneratedTextControls({
  draft,
  autoText,
  patch,
  withHints = false,
}: {
  readonly draft: AppVisualDraft;
  /** The derived initials the "auto" text mode currently resolves to. */
  readonly autoText: string;
  readonly patch: (next: { readonly [K in keyof AppVisualDraft]?: AppVisualDraft[K] | undefined }) => void;
  readonly withHints?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <TextField>
        <Label className="text-sm font-medium text-vdu-fg">
          {t("visualEditor.textModeLabel")}
        </Label>
        <ToggleButtonGroup
          selectionMode="single"
          selectedKeys={new Set([draft.textMode])}
          onSelectionChange={(keys) => {
            const value = [...keys][0];
            if (value === "auto" || value === "custom") {
              patch({ textMode: value });
            }
          }}
          aria-label={t("visualEditor.textModeLabel")}
          className="mt-1.5"
        >
          <ToggleButton id="auto">{t("visualEditor.textMode.auto")}</ToggleButton>
          <ToggleButton id="custom">{t("visualEditor.textMode.custom")}</ToggleButton>
        </ToggleButtonGroup>
      </TextField>
      {draft.textMode === "custom" ? (
        <>
          <TextField
            value={draft.customText}
            onChange={(customText) => patch({ customText })}
            autoComplete="off"
          >
            <Label className="text-sm font-medium text-vdu-fg">
              {t("visualEditor.customTextLabel")}
            </Label>
            <Input
              className="mt-1.5 h-10 max-w-[280px]"
              type="text"
              spellCheck={false}
              placeholder={t("visualEditor.customTextPlaceholder")}
            />
          </TextField>
          {withHints ? (
            <p className="text-xs leading-relaxed text-vdu-fg-muted">
              {t("visualEditor.customTextHint")}
            </p>
          ) : null}
        </>
      ) : withHints ? (
        <p className="text-xs leading-relaxed text-vdu-fg-muted">
          {t("visualEditor.textAutoHint", { text: autoText })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The small identity thumbnail in the icon row: the projected icon for
 * library/text sources, the pending upload preview otherwise.
 */
function IconRowThumbnail({
  draft,
  projected,
  pendingUpload,
}: {
  readonly draft: AppVisualDraft;
  readonly projected: AppShortcut;
  readonly pendingUpload: PendingUpload | null;
}) {
  if (draft.source === "upload") {
    return pendingUpload !== null ? (
      // eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable remote image
      <img
        className="vela-inspector__row-thumb"
        src={pendingUpload.previewUrl}
        alt=""
        draggable={false}
      />
    ) : (
      <span className="vela-inspector__row-thumb" aria-hidden="true" />
    );
  }
  if (draft.source === "library" && draft.libraryIcon.length > 0) {
    return <IconRowLibraryThumb iconId={draft.libraryIcon} />;
  }
  const text = appIconDisplayText(projected);
  return (
    <span className="vela-inspector__row-thumb vela-inspector__row-thumb--text" aria-hidden="true">
      {text}
    </span>
  );
}

/** The library glyph thumb for the icon row. */
function IconRowLibraryThumb({ iconId }: { readonly iconId: string }) {
  return (
    <span className="vela-inspector__row-thumb" aria-hidden="true">
      <IconPreview iconId={iconId} />
    </span>
  );
}

/** The derived initials an auto text mode resolves to right now. */
function autoGeneratedText(projected: AppShortcut): string {
  return projected.icon.kind === "generated" ? projected.icon.text : "";
}

/** Primary (human-readable) label for the icon row — never a raw catalog id. */
function describeDraftSourcePrimary(
  draft: AppVisualDraft,
  projected: AppShortcut,
  t: TranslateFn
): string {
  if (draft.source === "library") {
    return draft.libraryIcon.length > 0
      ? humanizeIconName(draft.libraryIcon)
      : t("visualEditor.tab.library");
  }
  if (draft.source === "upload") {
    return t("visualEditor.tab.upload");
  }
  if (draft.textMode === "custom" && draft.customText.length > 0) {
    return draft.customText;
  }
  const text = appIconDisplayText(projected);
  return text.length > 0 ? text : t("visualEditor.textMode.auto");
}

/** Secondary source tag for the icon row ("Icon library" / "Text" / …). */
function describeDraftSourceSecondary(draft: AppVisualDraft, t: TranslateFn): string {
  if (draft.source === "library") {
    return draft.libraryIcon.length > 0
      ? t("visualEditor.tab.library")
      : t("visualEditor.changeIcon");
  }
  if (draft.source === "upload") {
    return t("visualEditor.changeIcon");
  }
  return draft.textMode === "custom"
    ? t("visualEditor.textMode.custom")
    : t("visualEditor.tab.text");
}

function ColorSettingRow({
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
    <div className="flex items-center justify-between gap-6">
      <span className="text-sm font-medium text-vdu-fg">{label}</span>
      <ColorField
        label={label}
        autoLabel={autoLabel}
        swatchAriaLabel={value ?? autoLabel}
        value={value}
        onChange={onChange}
        className="max-w-[220px]"
      />
    </div>
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
