"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { MAX_GRID_GAP_PX, MIN_GRID_GAP_PX, GRID_GAP_STEP_PX } from "@veladesk/domain";
import type {
  WorkspaceAppearancePreferences,
  WorkspaceColorMode,
  WorkspaceSnapshot,
  WorkspaceWallpaperPreset,
} from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import type { UiLocale } from "../i18n/locale";
import type { TranslationKey } from "../i18n/messages";
import {
  areWorkspaceSettingsDraftsEqual,
  createWorkspaceSettingsDraft,
} from "./settings-draft";
import type { WorkspaceSettingsDraft } from "./settings-draft";
import "./home-shell.css";

export type SettingsSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

interface SettingsCenterProps {
  readonly workspace: WorkspaceSnapshot;

  /** Fires on every appearance control change — live preview, never staged. */
  readonly onPreviewAppearance: (appearance: WorkspaceAppearancePreferences) => void;

  /**
   * Persists the whole draft. Success closes this surface (the shell owns
   * that); failure keeps it open with the returned message inline.
   */
  readonly onSave: (draft: WorkspaceSettingsDraft) => Promise<SettingsSaveResult>;

  /** Cancel path: Escape, backdrop or the close button. */
  readonly onClose: () => void;
}

type SettingsSection = "appearance" | "layout" | "general";

const SECTION_LABEL_KEY: Readonly<Record<SettingsSection, TranslationKey>> = {
  appearance: "settings.section.appearance",
  layout: "settings.section.layout",
  general: "settings.section.general",
};

const COLOR_MODE_OPTIONS: readonly {
  readonly value: WorkspaceColorMode;
  readonly labelKey: TranslationKey;
}[] = [
  { value: "system", labelKey: "settings.colorMode.system" },
  { value: "dark", labelKey: "settings.colorMode.dark" },
  { value: "light", labelKey: "settings.colorMode.light" },
];

const WALLPAPER_OPTIONS: readonly {
  readonly value: WorkspaceWallpaperPreset;
  readonly labelKey: TranslationKey;
}[] = [
  { value: "aurora", labelKey: "settings.wallpaper.aurora" },
  { value: "midnight", labelKey: "settings.wallpaper.midnight" },
  { value: "dawn", labelKey: "settings.wallpaper.dawn" },
  { value: "mist", labelKey: "settings.wallpaper.mist" },
];

/**
 * The Settings Center V2 (task 017): a compact product-facing dialog with
 * three sections — Appearance, Layout, General — over a draft model of the
 * workspace preferences.
 *
 * Appearance leads with the three controls people actually change (color
 * mode, accent, wallpaper); surface opacity, blur and corner radius fold
 * into a collapsed Advanced group. Layout owns the default section, the
 * start-mode lock and the grid gap. The hidden iconSize field survives in
 * the draft and is preserved on Save.
 *
 * The component never imports the client runtime and never stages
 * anything: appearance changes preview live through
 * `onPreviewAppearance`, and only Save hands the draft back to the shell
 * for the domain edit + local stage. Cancel (Escape / backdrop / button)
 * simply closes — the shell then drops the preview and the desktop reverts
 * to the persisted appearance.
 *
 * The General section's interface language is deliberately NOT part of the
 * draft: it is a browser-local preference (see ui-localization.md) that
 * applies and persists immediately via `setLocale`, so switching it can
 * never dirty the draft or change the Save button state.
 */
export function SettingsCenter({
  workspace,
  onPreviewAppearance,
  onSave,
  onClose,
}: SettingsCenterProps) {
  const { locale, setLocale, t } = useI18n();
  const [draft, setDraft] = useState<WorkspaceSettingsDraft>(() =>
    createWorkspaceSettingsDraft(workspace),
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Focus the heading on open; restore the opener on close — same focus
  // contract as the launcher, no focus-trap dependency.
  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  const initialDraft = useMemo(() => createWorkspaceSettingsDraft(workspace), [workspace]);
  const dirty = !areWorkspaceSettingsDraftsEqual(draft, initialDraft);

  function updateAppearance(patch: Partial<WorkspaceAppearancePreferences>) {
    const next: WorkspaceSettingsDraft = {
      ...draft,
      appearance: { ...draft.appearance, ...patch },
    };
    setDraft(next);
    setError(null);
    onPreviewAppearance(next.appearance);
  }

  function updateLayout(patch: Partial<Omit<WorkspaceSettingsDraft, "appearance">>) {
    setDraft({ ...draft, ...patch });
    setError(null);
  }

  /** Immediate locale switch — browser preference, never part of the draft. */
  function updateLocale(next: UiLocale) {
    if (next !== locale) {
      setLocale(next);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function handleBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  async function handleSave() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onSave(draft);
      if (!result.ok) {
        setError(result.message);
      }
      // Success: the shell closes this surface and clears the preview.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="vela-settings-backdrop"
      data-vd-wheel-scope="local"
      onMouseDown={handleBackdropMouseDown}
      onKeyDown={handleKeyDown}
    >
      <section
        className="vela-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vela-settings-title"
      >
        <header className="vela-settings__header">
          <h2
            id="vela-settings-title"
            className="vela-settings__title"
            ref={headingRef}
            tabIndex={-1}
          >
            {t("settings.title")}
          </h2>
          <span className="vela-settings__spacer" />
          <button
            type="button"
            className="vela-button vela-settings__close"
            aria-label={t("settings.close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="vela-settings__body">
          <nav className="vela-settings__nav" aria-label={t("settings.sections")}>
            {(Object.keys(SECTION_LABEL_KEY) as readonly SettingsSection[]).map((section) => (
              <button
                key={section}
                type="button"
                className="vela-settings__nav-button"
                aria-current={activeSection === section ? "true" : undefined}
                onClick={() => setActiveSection(section)}
              >
                {t(SECTION_LABEL_KEY[section])}
              </button>
            ))}
          </nav>

          {/*
            Keyed by section: switching remounts the panel so the directional
            cross-fade replays (reduced motion disables it in CSS).
          */}
          <div
            key={activeSection}
            className="vela-settings__content"
            data-vd-wheel-scope="local"
            data-settings-section={activeSection}
          >
            {activeSection === "appearance" ? (
              <div className="vela-settings__section">
                <div
                  className="vela-settings__field"
                  role="radiogroup"
                  aria-labelledby="vela-settings-color-mode-label"
                >
                  <p className="vela-settings__field-label" id="vela-settings-color-mode-label">
                    {t("settings.colorMode")}
                  </p>
                  <div className="vela-segmented">
                    {COLOR_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="vela-segmented__option"
                        role="radio"
                        aria-checked={draft.appearance.colorMode === option.value}
                        onClick={() => updateAppearance({ colorMode: option.value })}
                      >
                        {t(option.labelKey)}
                      </button>
                    ))}
                  </div>
                  <p className="vela-settings__hint">{t("settings.colorMode.hint")}</p>
                </div>

                <div className="vela-settings__field">
                  <label
                    className="vela-settings__field-label"
                    htmlFor="vela-settings-accent-hue"
                  >
                    {t("settings.accentHue")}
                  </label>
                  <div className="vela-settings__row">
                    <input
                      id="vela-settings-accent-hue"
                      className="vela-settings__range"
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={draft.appearance.accentHue}
                      onChange={(event) =>
                        updateAppearance({ accentHue: Number(event.target.value) })
                      }
                    />
                    <output
                      className="vela-settings__value"
                      htmlFor="vela-settings-accent-hue"
                    >
                      {draft.appearance.accentHue}°
                    </output>
                  </div>
                </div>

                <div className="vela-settings__field">
                  <p className="vela-settings__field-label" id="vela-settings-wallpaper-label">
                    {t("settings.wallpaper")}
                  </p>
                  <div
                    className="vela-settings__swatches"
                    role="group"
                    aria-labelledby="vela-settings-wallpaper-label"
                  >
                    {WALLPAPER_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="vela-settings__swatch"
                        aria-pressed={draft.appearance.wallpaperPreset === option.value}
                        onClick={() => updateAppearance({ wallpaperPreset: option.value })}
                      >
                        <span
                          className="vela-settings__swatch-preview"
                          data-wallpaper={option.value}
                          aria-hidden="true"
                        />
                        {t(option.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vela-settings__advanced">
                  <button
                    type="button"
                    className="vela-settings__advanced-toggle"
                    aria-expanded={advancedOpen}
                    aria-controls="vela-settings-advanced-panel"
                    onClick={() => setAdvancedOpen((open) => !open)}
                  >
                    <span
                      className="vela-settings__advanced-chevron"
                      data-open={advancedOpen ? "true" : undefined}
                      aria-hidden="true"
                    >
                      ›
                    </span>
                    {t("settings.advancedAppearance")}
                  </button>
                  <div
                    id="vela-settings-advanced-panel"
                    className="vela-settings__advanced-panel"
                    data-open={advancedOpen ? "true" : undefined}
                  >
                    <div className="vela-settings__advanced-inner">
                      <div className="vela-settings__field">
                        <label
                          className="vela-settings__field-label"
                          htmlFor="vela-settings-opacity"
                        >
                          {t("settings.surfaceOpacity")}
                        </label>
                        <div className="vela-settings__row">
                          <input
                            id="vela-settings-opacity"
                            className="vela-settings__range"
                            type="range"
                            min={0.35}
                            max={0.9}
                            step={0.05}
                            value={draft.appearance.surfaceOpacity}
                            onChange={(event) =>
                              updateAppearance({ surfaceOpacity: Number(event.target.value) })
                            }
                          />
                          <output
                            className="vela-settings__value"
                            htmlFor="vela-settings-opacity"
                          >
                            {Math.round(draft.appearance.surfaceOpacity * 100)}%
                          </output>
                        </div>
                      </div>

                      <div className="vela-settings__field">
                        <label className="vela-settings__field-label" htmlFor="vela-settings-blur">
                          {t("settings.blur")}
                        </label>
                        <div className="vela-settings__row">
                          <input
                            id="vela-settings-blur"
                            className="vela-settings__range"
                            type="range"
                            min={0}
                            max={32}
                            step={1}
                            value={draft.appearance.blurPx}
                            onChange={(event) =>
                              updateAppearance({ blurPx: Number(event.target.value) })
                            }
                          />
                          <output className="vela-settings__value" htmlFor="vela-settings-blur">
                            {draft.appearance.blurPx}px
                          </output>
                        </div>
                      </div>

                      <div className="vela-settings__field">
                        <label
                          className="vela-settings__field-label"
                          htmlFor="vela-settings-radius"
                        >
                          {t("settings.cornerRadius")}
                        </label>
                        <div className="vela-settings__row">
                          <input
                            id="vela-settings-radius"
                            className="vela-settings__range"
                            type="range"
                            min={8}
                            max={24}
                            step={1}
                            value={draft.appearance.radiusPx}
                            onChange={(event) =>
                              updateAppearance({ radiusPx: Number(event.target.value) })
                            }
                          />
                          <output className="vela-settings__value" htmlFor="vela-settings-radius">
                            {draft.appearance.radiusPx}px
                          </output>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeSection === "layout" ? (
              <div className="vela-settings__section">
                <div className="vela-settings__field">
                  <label
                    className="vela-settings__field-label"
                    htmlFor="vela-settings-default-page"
                  >
                    {t("settings.defaultPage")}
                  </label>
                  <select
                    id="vela-settings-default-page"
                    className="vela-select"
                    value={draft.defaultPageId}
                    onChange={(event) => updateLayout({ defaultPageId: event.target.value })}
                  >
                    {workspace.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                  <p className="vela-settings__hint">{t("settings.defaultPageHint")}</p>
                </div>

                <div className="vela-settings__field vela-settings__field--row">
                  <div>
                    <p className="vela-settings__field-label">{t("settings.startInView")}</p>
                    <p className="vela-settings__hint">{t("settings.startInViewHint")}</p>
                  </div>
                  <button
                    type="button"
                    className="vela-switch"
                    role="switch"
                    aria-checked={draft.layoutLocked}
                    onClick={() => updateLayout({ layoutLocked: !draft.layoutLocked })}
                  >
                    <span className="vela-switch__knob" aria-hidden="true" />
                  </button>
                </div>

                <div className="vela-settings__field">
                  <label
                    className="vela-settings__field-label"
                    htmlFor="vela-settings-grid-gap"
                  >
                    {t("settings.gridGap")}
                  </label>
                  <div className="vela-settings__row">
                    <input
                      id="vela-settings-grid-gap"
                      className="vela-settings__range"
                      type="range"
                      min={MIN_GRID_GAP_PX}
                      max={MAX_GRID_GAP_PX}
                      step={GRID_GAP_STEP_PX}
                      value={draft.gridGapPx}
                      onChange={(event) =>
                        updateLayout({ gridGapPx: Number(event.target.value) })
                      }
                    />
                    <output className="vela-settings__value" htmlFor="vela-settings-grid-gap">
                      {draft.gridGapPx}px
                    </output>
                  </div>
                  <p className="vela-settings__hint">{t("settings.gridGapHint")}</p>
                </div>
              </div>
            ) : (
              <div className="vela-settings__section">
                <div
                  className="vela-settings__field"
                  role="radiogroup"
                  aria-labelledby="vela-settings-language-label"
                >
                  <p className="vela-settings__field-label" id="vela-settings-language-label">
                    {t("settings.language")}
                  </p>
                  <div className="vela-segmented">
                    {/* Endonyms by design: 中文 and English read natively in
                        every locale. */}
                    <button
                      type="button"
                      className="vela-segmented__option"
                      role="radio"
                      aria-checked={locale === "zh-CN"}
                      onClick={() => updateLocale("zh-CN")}
                    >
                      {t("settings.language.chinese")}
                    </button>
                    <button
                      type="button"
                      className="vela-segmented__option"
                      role="radio"
                      aria-checked={locale === "en-US"}
                      onClick={() => updateLocale("en-US")}
                    >
                      {t("settings.language.english")}
                    </button>
                  </div>
                  <p className="vela-settings__hint">{t("settings.language.hint")}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="vela-settings__footer">
          {error !== null ? (
            <p className="vela-settings__error" role="alert">
              {error}
            </p>
          ) : (
            <p className="vela-settings__dirty" aria-live="polite">
              {dirty ? t("settings.unsavedChanges") : t("settings.upToDate")}
            </p>
          )}
          <button type="button" className="vela-button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="vela-button vela-button--primary"
            onClick={() => void handleSave()}
            disabled={!dirty || busy}
          >
            {busy ? t("settings.saving") : t("common.save")}
          </button>
        </footer>
      </section>
    </div>
  );
}
