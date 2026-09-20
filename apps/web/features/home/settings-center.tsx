"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { DEFAULT_WORKSPACE_APPEARANCE } from "@veladesk/domain";
import type {
  WorkspaceAppearancePreferences,
  WorkspaceColorMode,
  WorkspaceIconSize,
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

type SettingsSection = "appearance" | "desktop" | "general";

const SECTION_LABEL_KEY: Readonly<Record<SettingsSection, TranslationKey>> = {
  appearance: "settings.section.appearance",
  desktop: "settings.section.desktop",
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

const ICON_SIZE_OPTIONS: readonly {
  readonly value: WorkspaceIconSize;
  readonly labelKey: TranslationKey;
}[] = [
  { value: "small", labelKey: "settings.iconSize.small" },
  { value: "medium", labelKey: "settings.iconSize.medium" },
  { value: "large", labelKey: "settings.iconSize.large" },
];

/**
 * The workspace Settings Center: one large glass overlay with section
 * navigation (Appearance / Desktop / General) over a draft model of the
 * workspace preferences.
 *
 * The component never imports the client runtime and never stages
 * anything: appearance changes preview live through `onPreviewAppearance`,
 * and only Save hands the draft back to the shell for the domain edit +
 * local stage. Cancel (Escape / backdrop / button) simply closes — the
 * shell then drops the preview and the desktop reverts to the persisted
 * appearance.
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

  function updateDesktop(patch: Partial<Omit<WorkspaceSettingsDraft, "appearance">>) {
    setDraft({ ...draft, ...patch });
    setError(null);
  }

  function resetAppearance() {
    const next: WorkspaceSettingsDraft = {
      ...draft,
      appearance: { ...DEFAULT_WORKSPACE_APPEARANCE },
    };
    setDraft(next);
    setError(null);
    onPreviewAppearance(next.appearance);
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
    <div className="vela-settings-backdrop" onMouseDown={handleBackdropMouseDown} onKeyDown={handleKeyDown}>
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

          <div className="vela-settings__content" data-vd-wheel-scope="local">
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
                  <div className="vela-settings__radio-row">
                    {COLOR_MODE_OPTIONS.map((option) => (
                      <label key={option.value} className="vela-settings__radio">
                        <input
                          type="radio"
                          name="vela-settings-color-mode"
                          checked={draft.appearance.colorMode === option.value}
                          onChange={() => updateAppearance({ colorMode: option.value })}
                        />
                        {t(option.labelKey)}
                      </label>
                    ))}
                  </div>
                  <p className="vela-settings__hint">{t("settings.colorMode.hint")}</p>
                </div>

                <div className="vela-settings__field">
                  <label className="vela-settings__field-label" htmlFor="vela-settings-accent-hue">
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
                    <output className="vela-settings__value" htmlFor="vela-settings-accent-hue">
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

                <div className="vela-settings__field">
                  <label className="vela-settings__field-label" htmlFor="vela-settings-opacity">
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
                    <output className="vela-settings__value" htmlFor="vela-settings-opacity">
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
                  <label className="vela-settings__field-label" htmlFor="vela-settings-radius">
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

                <div
                  className="vela-settings__field"
                  role="radiogroup"
                  aria-labelledby="vela-settings-icon-size-label"
                >
                  <p className="vela-settings__field-label" id="vela-settings-icon-size-label">
                    {t("settings.iconSize")}
                  </p>
                  <div className="vela-settings__radio-row">
                    {ICON_SIZE_OPTIONS.map((option) => (
                      <label key={option.value} className="vela-settings__radio">
                        <input
                          type="radio"
                          name="vela-settings-icon-size"
                          checked={draft.appearance.iconSize === option.value}
                          onChange={() => updateAppearance({ iconSize: option.value })}
                        />
                        {t(option.labelKey)}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="vela-settings__field">
                  <button
                    type="button"
                    className="vela-button"
                    onClick={resetAppearance}
                    disabled={busy}
                  >
                    {t("settings.resetAppearance")}
                  </button>
                  <p className="vela-settings__hint">{t("settings.resetHint")}</p>
                </div>
              </div>
            ) : activeSection === "desktop" ? (
              <div className="vela-settings__section">
                <div className="vela-settings__field">
                  <label className="vela-settings__field-label" htmlFor="vela-settings-default-page">
                    {t("settings.defaultPage")}
                  </label>
                  <select
                    id="vela-settings-default-page"
                    className="vela-select"
                    value={draft.defaultPageId}
                    onChange={(event) => updateDesktop({ defaultPageId: event.target.value })}
                  >
                    {workspace.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name}
                      </option>
                    ))}
                  </select>
                  <p className="vela-settings__hint">{t("settings.defaultPageHint")}</p>
                </div>

                <div className="vela-settings__field">
                  <label className="vela-settings__radio">
                    <input
                      type="checkbox"
                      checked={draft.layoutLocked}
                      onChange={(event) =>
                        updateDesktop({ layoutLocked: event.target.checked })
                      }
                    />
                    {t("settings.startInView")}
                  </label>
                  <p className="vela-settings__hint">{t("settings.startInViewHint")}</p>
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
                  <div className="vela-settings__radio-row">
                    {/* Endonyms by design: 中文 and English read natively in
                        every locale. */}
                    <label className="vela-settings__radio">
                      <input
                        type="radio"
                        name="vela-settings-language"
                        checked={locale === "zh-CN"}
                        onChange={() => updateLocale("zh-CN")}
                      />
                      {t("settings.language.chinese")}
                    </label>
                    <label className="vela-settings__radio">
                      <input
                        type="radio"
                        name="vela-settings-language"
                        checked={locale === "en-US"}
                        onChange={() => updateLocale("en-US")}
                      />
                      {t("settings.language.english")}
                    </label>
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
