"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AppShortcut, WorkspaceSnapshot } from "@veladesk/domain";
import { replaceApp } from "@veladesk/domain";
import type { WorkspaceEditFailureReason } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import type { TranslateFn } from "../i18n/use-i18n";
import { AppIconTile } from "./app-icon-renderer";
import {
  MAX_SCALE_PERCENT,
  MIN_SCALE_PERCENT,
  SCALE_STEP_PERCENT,
  buildDraftApp,
  decorationStyleChoices,
  draftEquals,
  draftFromApp,
  isDraftSavable,
  percentFromScale,
  scaleFromPercent,
  validateIconText,
} from "./app-visual-draft";
import type { AppVisualDraft } from "./app-visual-draft";
import { IconPicker } from "./icon-picker";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import "./home-shell.css";

/**
 * App Visual Editor (task 016-A) — icon source, size, colors and
 * decoration style for ONE app, opened from the app context menu's
 * "Edit appearance…".
 *
 * The top preview renders the draft through the same AppIconRenderer as
 * the desktop. Every change stays in the draft: nothing is staged until
 * Save (`replaceApp` → local stage → sync attempt), and Cancel closes
 * with zero mutation. The upload tab is displayed disabled on purpose —
 * uploaded assets arrive in 016-B and are not faked here.
 */

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
        className="vela-dialog vela-visual-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vela-visual-editor-title"
      >
        <h2 id="vela-visual-editor-title" className="vela-dialog__title">
          {t("visualEditor.title", { name: existing.name })}
        </h2>

        {/* Live draft preview — same renderer as the desktop, larger slot. */}
        <div className="vela-visual-editor__preview" data-vd-slot-size="preview">
          <AppIconTile app={previewApp} />
          <span className="vela-visual-editor__preview-name">{existing.name}</span>
        </div>

        <form className="vela-form" onSubmit={handleSubmit}>
          <div className="vela-visual-editor__tabs" role="tablist" aria-label={t("visualEditor.sourceLabel")}>
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
              aria-selected={false}
              disabled
              className="vela-visual-editor__tab"
              title={t("visualEditor.tab.uploadLater")}
            >
              {t("visualEditor.tab.upload")}
            </button>
          </div>

          {draft.source === "library" ? (
            <IconPicker
              selectedId={draft.libraryIcon.length > 0 ? draft.libraryIcon : null}
              onSelect={(iconId) => patch({ libraryIcon: iconId })}
            />
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

          <label className="vela-form__label" htmlFor="vela-visual-scale">
            {t("visualEditor.iconSize", { percent: percentFromScale(draft.iconScale) })}
          </label>
          <input
            id="vela-visual-scale"
            type="range"
            min={MIN_SCALE_PERCENT}
            max={MAX_SCALE_PERCENT}
            step={SCALE_STEP_PERCENT}
            value={percentFromScale(draft.iconScale)}
            onChange={(event) => patch({ iconScale: scaleFromPercent(Number(event.target.value)) })}
          />

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

          <ColorRow
            label={t("visualEditor.foregroundColor")}
            autoLabel={t("visualEditor.autoColor")}
            value={draft.foregroundColor}
            onChange={(value) => patch({ foregroundColor: value })}
          />
          <ColorRow
            label={t("visualEditor.decorationColor")}
            autoLabel={t("visualEditor.autoColor")}
            value={draft.decorationColor}
            onChange={(value) => patch({ decorationColor: value })}
          />

          {error !== null ? (
            <p className="vela-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="vela-dialog__actions">
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
