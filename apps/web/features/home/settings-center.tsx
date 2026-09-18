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

type SettingsSection = "appearance" | "desktop";

const COLOR_MODE_OPTIONS: readonly { readonly value: WorkspaceColorMode; readonly label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const WALLPAPER_OPTIONS: readonly {
  readonly value: WorkspaceWallpaperPreset;
  readonly label: string;
}[] = [
  { value: "aurora", label: "Aurora" },
  { value: "midnight", label: "Midnight" },
  { value: "dawn", label: "Dawn" },
  { value: "mist", label: "Mist" },
];

const ICON_SIZE_OPTIONS: readonly { readonly value: WorkspaceIconSize; readonly label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

/**
 * The workspace Settings Center: one large glass overlay with section
 * navigation (Appearance / Desktop) over a draft model of the workspace
 * preferences.
 *
 * The component never imports the client runtime and never stages
 * anything: appearance changes preview live through `onPreviewAppearance`,
 * and only Save hands the draft back to the shell for the domain edit +
 * local stage. Cancel (Escape / backdrop / button) simply closes — the
 * shell then drops the preview and the desktop reverts to the persisted
 * appearance.
 */
export function SettingsCenter({
  workspace,
  onPreviewAppearance,
  onSave,
  onClose,
}: SettingsCenterProps) {
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
            Settings
          </h2>
          <span className="vela-settings__spacer" />
          <button
            type="button"
            className="vela-button vela-settings__close"
            aria-label="Close settings"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="vela-settings__body">
          <nav className="vela-settings__nav" aria-label="Settings sections">
            <button
              type="button"
              className="vela-settings__nav-button"
              aria-current={activeSection === "appearance" ? "true" : undefined}
              onClick={() => setActiveSection("appearance")}
            >
              Appearance
            </button>
            <button
              type="button"
              className="vela-settings__nav-button"
              aria-current={activeSection === "desktop" ? "true" : undefined}
              onClick={() => setActiveSection("desktop")}
            >
              Desktop
            </button>
          </nav>

          <div className="vela-settings__content">
            {activeSection === "appearance" ? (
              <div className="vela-settings__section">
                <div
                  className="vela-settings__field"
                  role="radiogroup"
                  aria-labelledby="vela-settings-color-mode-label"
                >
                  <p className="vela-settings__field-label" id="vela-settings-color-mode-label">
                    Color mode
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
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <p className="vela-settings__hint">
                    System follows your operating system preference.
                  </p>
                </div>

                <div className="vela-settings__field">
                  <label className="vela-settings__field-label" htmlFor="vela-settings-accent-hue">
                    Accent hue
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
                    Wallpaper
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
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vela-settings__field">
                  <label className="vela-settings__field-label" htmlFor="vela-settings-opacity">
                    Surface opacity
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
                    Blur
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
                    Corner radius
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
                    Icon size
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
                        {option.label}
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
                    Reset appearance
                  </button>
                  <p className="vela-settings__hint">
                    Restores the default look in this draft — nothing is saved until you press Save.
                  </p>
                </div>
              </div>
            ) : (
              <div className="vela-settings__section">
                <div className="vela-settings__field">
                  <label className="vela-settings__field-label" htmlFor="vela-settings-default-page">
                    Default page
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
                  <p className="vela-settings__hint">
                    Applied the next time the workspace loads — the current page does not switch.
                  </p>
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
                    Start in View mode
                  </label>
                  <p className="vela-settings__hint">
                    Startup default only — the current mode is not switched, and the workspace
                    opens in View mode when checked or Arrange mode when unchecked.
                  </p>
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
              {dirty ? "Unsaved changes" : "Up to date"}
            </p>
          )}
          <button type="button" className="vela-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="vela-button vela-button--primary"
            onClick={() => void handleSave()}
            disabled={!dirty || busy}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </section>
    </div>
  );
}
