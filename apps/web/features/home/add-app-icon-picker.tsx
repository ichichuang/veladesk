"use client";

import { useState } from "react";
import type {
  ChangeEvent,
  Dispatch,
  DragEvent as ReactDragEvent,
  ClipboardEvent as ReactClipboardEvent,
  RefObject,
} from "react";
import { Input, Label, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import {
  firstClipboardImage,
  firstImageFile,
  prepareUploadedImage,
} from "./asset-upload";
import type { UploadValidationIssue } from "./asset-upload";
import { validateIconText } from "./app-visual-draft";
import { generatedIconText } from "./generated-icon";
import { IconPicker } from "./icon-picker";
import type { AddAppIconDraft, SmartAddAction } from "../app-recognition/smart-add-state";
import { Dialog, DialogContent, DialogTitle } from "@components/ui/dialog";
import "./home-shell.css";

/**
 * The Add-App icon picker (020-A §33, §36): the same Library / Text /
 * Upload sources and polished controls as the appearance inspector's
 * picker, bound to the Add-App form's icon draft instead of the visual
 * editor's. Manual selection here marks the icon user-owned; recognition
 * never overwrites it afterwards.
 */
export function AddAppIconPickerDialog({
  value,
  name,
  dispatch,
  fileInputRef,
  onClose,
}: {
  readonly value: AddAppIconDraft;
  /** The current app name — drives the auto-initials hint. */
  readonly name: string;
  readonly dispatch: Dispatch<SmartAddAction>;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"library" | "text" | "upload">(initialTab(value));
  const [customText, setCustomText] = useState(value.kind === "custom-text" ? value.text : "");
  const [uploadIssue, setUploadIssue] = useState<UploadValidationIssue | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const pendingPreviewUrl = value.kind === "pending-upload" ? value.previewUrl : null;

  async function acceptImage(blob: Blob) {
    setUploadBusy(true);
    setUploadIssue(null);
    try {
      const prepared = await prepareUploadedImage(blob);
      if (!prepared.ok) {
        setUploadIssue(prepared.issue);
        return;
      }
      dispatch({
        type: "edit-icon",
        value: {
          kind: "pending-upload",
          asset: prepared.upload.asset,
          previewUrl: prepared.upload.previewUrl,
        },
      });
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

  const textIssue = customText.trim().length > 0 ? validateIconText(customText) : undefined;

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
          <DialogTitle className="truncate text-base">{t("visualEditor.changeIcon")}</DialogTitle>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-5 pt-4">
            <ToggleButtonGroup
              selectionMode="single"
              selectedKeys={new Set([tab])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next === "library" || next === "text" || next === "upload") {
                  setTab(next);
                }
              }}
              aria-label={t("visualEditor.sourceLabel")}
            >
              <ToggleButton id="library">{t("visualEditor.tab.library")}</ToggleButton>
              <ToggleButton id="text">{t("visualEditor.tab.text")}</ToggleButton>
              <ToggleButton id="upload">{t("visualEditor.tab.upload")}</ToggleButton>
            </ToggleButtonGroup>
          </div>

          {tab === "library" ? (
            <div className="vela-visual-editor__picker-bound flex min-h-0 flex-1 flex-col">
              <IconPicker
                selectedId={value.kind === "library" ? value.iconId : null}
                onSelect={(iconId) => {
                  dispatch({ type: "edit-icon", value: { kind: "library", iconId } });
                  onClose();
                }}
              />
            </div>
          ) : tab === "upload" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4">
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
                {pendingPreviewUrl !== null ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable remote image
                  <img
                    className="vela-upload-dropzone__preview"
                    src={pendingPreviewUrl}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span className="vela-upload-dropzone__hint">
                    {t("visualEditor.upload.dropHere")}
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
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4">
              <TextField>
                <Label className="text-sm font-medium text-vdu-fg">
                  {t("visualEditor.textModeLabel")}
                </Label>
                <ToggleButtonGroup
                  selectionMode="single"
                  selectedKeys={new Set([value.kind === "custom-text" ? "custom" : "auto"])}
                  onSelectionChange={(keys) => {
                    const mode = [...keys][0];
                    if (mode === "auto") {
                      dispatch({ type: "edit-icon", value: { kind: "generated" } });
                    } else if (mode === "custom") {
                      dispatch({
                        type: "edit-icon",
                        value: { kind: "custom-text", text: customText },
                      });
                    }
                  }}
                  aria-label={t("visualEditor.textModeLabel")}
                  className="mt-1.5"
                >
                  <ToggleButton id="auto">{t("visualEditor.textMode.auto")}</ToggleButton>
                  <ToggleButton id="custom">{t("visualEditor.textMode.custom")}</ToggleButton>
                </ToggleButtonGroup>
              </TextField>
              {value.kind === "custom-text" ? (
                <>
                  <TextField
                    value={customText}
                    onChange={(text) => {
                      setCustomText(text);
                      dispatch({ type: "edit-icon", value: { kind: "custom-text", text } });
                    }}
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
                  {textIssue !== undefined ? (
                    <p className="text-xs text-vdu-danger" role="alert">
                      {textIssue === "empty"
                        ? t("visualEditor.error.enterText")
                        : t("visualEditor.error.textTooLong")}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-xs leading-relaxed text-vdu-fg-muted">
                  {t("visualEditor.textAutoHint", { text: generatedIconText(name) })}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function initialTab(value: AddAppIconDraft): "library" | "text" | "upload" {
  if (value.kind === "pending-upload") {
    return "upload";
  }
  if (value.kind === "custom-text" || value.kind === "generated") {
    return "text";
  }
  return "library";
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
