"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  CloseButton,
  Select,
  ListBox,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { Minus, Plus } from "lucide-react";
import { HexColorPicker } from "react-colorful";
import {
  MAX_GRID_GAP_PX,
  MIN_GRID_GAP_PX,
  GRID_GAP_STEP_PX,
  INTERFACE_STYLES,
  inferInterfaceStyle,
  resolveEffectiveWallpaper,
} from "@veladesk/domain";
import type {
  DesktopPageId,
  WallpaperConfig,
  WallpaperFit,
} from "@veladesk/domain";

import type {
  WorkspaceAppearancePreferences,
  WorkspaceColorMode,
  WorkspaceInterfaceStyle,
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
import { ACCENT_SWATCH_HUES, hexFromHue, hueFromHex } from "./accent-color";
import { Dialog, DialogContent, DialogTitle } from "@components/ui/dialog";
import { WallpaperSurface, type BackgroundPreview } from "./desktop-wallpaper";
import {
  prepareWallpaperImage,
  type PreparedWallpaperImage,
} from "./wallpaper-prep";
import { MAX_ASSET_BYTES } from "@veladesk/assets/core";
import { VELADESK_VERSION } from "../../lib/app-version";
import { buildImportAiPrompt } from "../import-json/ai-prompt";
import { copyTextToClipboard } from "../import-json/clipboard";
import { downloadVelaDeskImportTemplate } from "../import-json/template";
import { ImportJsonDialog } from "../import-json/import-json-dialog";

/** The EFFECTIVE upload cap rendered to users: the shared core byte budget. */
const EFFECTIVE_UPLOAD_LIMIT_MIB = Math.round(MAX_ASSET_BYTES / (1024 * 1024));
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { BrandLogo } from "@components/vd/brand-logo";
import { VdScrollArea } from "@components/vd/scroll-area";
import { VdSwitch } from "@components/vd/switch";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, VD_MOTION } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import "./home-shell.css";

export type SettingsSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

interface SettingsCenterProps {
  /** Requested visibility; the window stays mounted through its exit. */
  readonly open: boolean;

  readonly workspace: WorkspaceSnapshot;

  /** Fires on every appearance control change — live preview, never staged. */
  readonly onPreviewAppearance: (appearance: WorkspaceAppearancePreferences) => void;

  /**
   * Persists the whole draft. Success closes this surface (the shell owns
   * that); failure keeps it open with the returned message inline.
   */
  readonly onSave: (
    draft: WorkspaceSettingsDraft,
    images: readonly PreparedWallpaperImage[],
  ) => Promise<SettingsSaveResult>;

  /** Cancel path: Escape, backdrop or the close button. */
  readonly onClose: () => void;

  /**
   * Entering through a section's context menu opens the shared background
   * editor with that section preselected (023-C.2). Null/undefined opens
   * on the workspace default scope.
   */
  readonly backgroundEntrySectionId?: DesktopPageId | null | undefined;

  /** The section currently on screen — only its scope previews live. */
  readonly activeSectionId?: DesktopPageId | null | undefined;

  /** Streams the background draft to the desktop as a live preview. */
  readonly onPreviewBackground?: ((preview: BackgroundPreview | null) => void) | undefined;
}

type SettingsSection = "appearance" | "layout" | "general";

const SETTINGS_SECTIONS: readonly SettingsSection[] = ["appearance", "layout", "general"];

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

const INTERFACE_STYLE_LABEL_KEY: Readonly<Record<WorkspaceInterfaceStyle, TranslationKey>> = {
  clean: "settings.interfaceStyle.clean",
  soft: "settings.interfaceStyle.soft",
  glass: "settings.interfaceStyle.glass",
};

const INTERFACE_STYLE_HINT_KEY: Readonly<Record<WorkspaceInterfaceStyle, TranslationKey>> = {
  clean: "settings.interfaceStyle.clean.hint",
  soft: "settings.interfaceStyle.soft.hint",
  glass: "settings.interfaceStyle.glass.hint",
};

/**
 * The Settings Center (017, rebuilt 018, product-grade 019-D, fixed frame
 * 023-R2): ONE stable window — branded header with a close affordance, a
 * fixed-width navigation column, an independently scrollable content pane
 * and a fixed action footer. The frame is an EXACT contract: on a normal
 * desktop viewport the painted window surface is exactly 880×680 CSS px,
 * owned by the ONE canonical stylesheet rule in home-shell.css keyed on
 * this surface's `data-settings-surface` marker (definite width/height,
 * clamped on smaller viewports by max-width/max-height with 16px margins,
 * a @supports layer upgrading vh to dvh; `flex: none` so the flex
 * algorithm never touches the frame, and the internal 52px /
 * minmax(0,1fr) / 60px grid rows owned by the same rule). All sections
 * share the same outer dimensions and origin — switching tabs, loading
 * options or showing validation text never resizes or recenters the
 * window: only the pane's content animates (a tabContent-token
 * cross-fade), short content leaves the body's remaining space blank,
 * long content scrolls inside the pane behind nothing, and
 * header/nav/footer stay fixed. The rule text is the CSS contract; jsdom
 * tests assert wiring and structure, never measured pixels.
 *
 * Controls are canonical HeroUI components themed through the --vdu-*
 * token bridge; wallpaper and interface-style preview cards are the only
 * custom surfaces because they show live product previews. Every control
 * edits the same draft model as before: appearance changes preview live
 * through onPreviewAppearance, Save is the only staging path (and
 * normalizes the interface style into canonical surface values),
 * Cancel/Escape drop the preview, and the interface language stays an
 * immediate browser-local preference outside the draft. The window is
 * solid by construction — desktop surface preferences feed the desktop
 * only, never this window (the vd-ui token layer ignores them).
 */
export function SettingsCenter({
  open,
  workspace,
  onPreviewAppearance,
  onSave,
  onClose,
  backgroundEntrySectionId = null,
  activeSectionId = null,
  onPreviewBackground,
}: SettingsCenterProps) {
  const { locale, setLocale, t } = useI18n();
  const [draft, setDraft] = useState<WorkspaceSettingsDraft>(() =>
    createWorkspaceSettingsDraft(workspace),
  );
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");
  /** Direction of the last section switch: +1 forward, −1 back (§13). */
  const directionRef = useRef<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useVdReducedMotion();

  // The window is open-driven and stays mounted through its exit (022);
  // each OPEN transition therefore re-initializes the draft — the same
  // fresh state a remount used to produce. While open, the draft is owned
  // by the user (a snapshot landing mid-session never resets it).
  const [backgroundScope, setBackgroundScope] = useState<"workspace" | DesktopPageId>(
    backgroundEntrySectionId ?? "workspace",
  );
  const [backgroundImage, setBackgroundImage] = useState<PreparedWallpaperImage | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previousOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (open && !wasOpen) {
      setDraft(createWorkspaceSettingsDraft(workspace));
      setActiveSection("appearance");
      directionRef.current = 1;
      setBusy(false);
      setError(null);
      // A fresh settings session starts on the entry scope (a section's
      // context menu preselects it) and releases any stale pending image.
      if (backgroundImage !== null) {
        URL.revokeObjectURL(backgroundImage.previewUrl);
      }
      setBackgroundImage(null);
      setBackgroundError(null);
      setBackgroundScope(backgroundEntrySectionId ?? "workspace");
      onPreviewBackground?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-transition lifecycle only
  }, [open, workspace]);

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

  /**
   * Streams the scoped background draft to the desktop (023-C.2): only
   * the ACTIVE section's scope previews live — a non-active section keeps
   * its renderer-based thumbnail instead of navigating the desktop. The
   * workspace layer previews whenever it is the edited scope; a section
   * override on the active section deliberately masks it (the resolver
   * explains provenance, the preview does not erase the override).
   */
  function publishBackgroundPreview(next: WorkspaceSettingsDraft): void {
    if (onPreviewBackground === undefined) {
      return;
    }
    const active = activeSectionId;
    if (active !== null && next.background.pages[active] !== undefined) {
      const config = next.background.pages[active];
      onPreviewBackground({
        scope: active,
        config,
        explicitlyInherits: config === null,
        ...(backgroundImage !== null && config?.kind === "asset" && config.assetId === backgroundImage.asset.id
          ? { pendingAssetId: backgroundImage.asset.id, previewUrl: backgroundImage.previewUrl }
          : {}),
      });
      return;
    }
    if (next.background.workspace !== undefined) {
      onPreviewBackground({
        scope: "workspace",
        config: next.background.workspace,
        explicitlyInherits: false,
        ...(backgroundImage !== null && next.background.workspace?.kind === "asset" && next.background.workspace.assetId === backgroundImage.asset.id
          ? { pendingAssetId: backgroundImage.asset.id, previewUrl: backgroundImage.previewUrl }
          : {}),
      });
      return;
    }
    onPreviewBackground(null);
  }

  function updateBackground(patch: Partial<WorkspaceSettingsDraft["background"]>) {
    const next: WorkspaceSettingsDraft = {
      ...draft,
      background: { ...draft.background, ...patch },
    };
    setDraft(next);
    setError(null);
    publishBackgroundPreview(next);
  }

  /** Immediate locale switch — browser preference, never part of the draft. */
  function updateLocale(next: UiLocale) {
    if (next !== locale) {
      setLocale(next);
    }
  }

  async function handleSave() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onSave(draft, backgroundImage === null ? [] : [backgroundImage]);
      if (!result.ok) {
        setError(result.message);
        // The draft (and its pending image) is deliberately KEPT so the
        // user can resolve the conflict; nothing was silently discarded.
        return;
      }
      // Success: the shell closes this surface and clears the preview. The
      // pending preview URL stays until then — the desktop may still be
      // displaying it.
    } finally {
      setBusy(false);
    }
  }

  /** Direction of the section switch: +1 forward, −1 back (§13 motion). */
  function selectSection(next: SettingsSection) {
    if (next === activeSection) {
      return;
    }
    directionRef.current =
      SETTINGS_SECTIONS.indexOf(next) > SETTINGS_SECTIONS.indexOf(activeSection) ? 1 : -1;
    setActiveSection(next);
  }

  /**
   * The content pane's scroll element — the ONE ordinary scroll owner.
   * A tab CHANGE may reset it to the top once so the new pane's heading is
   * visible; draft changes, preset picks, upload validation and unrelated
   * rerenders never touch scroll position (the reset lives inside the
   * tab-switch effect below, not in render).
   */
  const settingsPaneRef = useRef<HTMLDivElement | null>(null);

  /**
   * The 022 pane transition: business state (the section) changes
   * immediately; GSAP interpolates the NEW pane in from the switch
   * direction (x ±8px, fade) on the tabContent token. One owned tween,
   * skipped for the first render and under reduced motion. The pane never
   * gates interaction on the animation.
   */
  const paneRef = useRef<HTMLDivElement | null>(null);
  const previousSectionRef = useRef<SettingsSection>(activeSection);
  useLayoutEffect(() => {
    const element = paneRef.current;
    if (element === null || previousSectionRef.current === activeSection) {
      previousSectionRef.current = activeSection;
      return;
    }
    previousSectionRef.current = activeSection;
    // Exactly one reset per accepted tab change — the new pane starts at
    // its heading; no polling, no scrollIntoView on any ancestor.
    if (settingsPaneRef.current !== null) {
      settingsPaneRef.current.scrollTop = 0;
    }
    if (reducedMotion) {
      gsap.set(element, { opacity: 1, x: 0 });
      return;
    }
    gsap.fromTo(
      element,
      { opacity: 0, x: 8 * directionRef.current },
      {
        opacity: 1,
        x: 0,
        duration: VD_MOTION.tabContent,
        ease: VD_MOTION_EASE,
        overwrite: "auto",
      },
    );
  }, [activeSection, reducedMotion]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        data-settings-dialog=""
        data-vd-wheel-scope="local"
        surfaceProps={{ "data-settings-surface": "" }}
      >
        {/* The background editor's image picker (023-C.3): selection only
            creates a candidate + preview URL — nothing stages or saves. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          data-testid="wallpaper-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) {
              return;
            }
            setBackgroundBusy(true);
            setBackgroundError(null);
            void prepareWallpaperImage(file)
              .then((result) => {
                if (!result.ok) {
                  setBackgroundError(
                    t({
                      "asset-empty": "settings.background.error.empty",
                      "asset-too-large": "settings.background.error.tooLarge",
                      "unsupported-image-type": "settings.background.error.unsupported",
                      "decode-failed": "settings.background.error.decode",
                      "dimensions-too-large": "settings.background.error.dimensions",
                    }[result.issue] as TranslationKey),
                  );
                  return;
                }
                if (backgroundImage !== null) {
                  URL.revokeObjectURL(backgroundImage.previewUrl);
                }
                setBackgroundImage(result.image);
                const config: WallpaperConfig = {
                  kind: "asset",
                  assetId: result.image.asset.id,
                  fit: "cover",
                  position: "center",
                };
                if (backgroundScope === "workspace") {
                  updateBackground({ workspace: config });
                } else {
                  updateBackground({ pages: { ...draft.background.pages, [backgroundScope]: config } });
                }
              })
              .finally(() => setBackgroundBusy(false));
          }}
        />

        {/* Fixed header row (52px, grid-owned): brand mark, title, close. */}
        <header className="flex min-h-0 items-center gap-3 overflow-hidden border-b border-vdu-border px-5">
          <BrandLogo size={28} className="shrink-0" alt="" />
          <DialogTitle className="text-base">{t("settings.title")}</DialogTitle>
          <CloseButton
            aria-label={t("settings.close")}
            className="ml-auto scale-90 text-vdu-fg-muted"
            onPress={onClose}
          />
        </header>

        <div className="flex min-h-0 min-w-0">
          {/* Fixed-width left navigation: full-width centered rows — one
              quiet designed nav, no floating pill container. Selection
              feedback is a CSS state change on the motion tokens. */}
          <nav
            className="flex min-h-0 w-[160px] shrink-0 flex-col border-r border-vdu-border p-3"
            aria-label={t("settings.sections")}
          >
            <div role="tablist" aria-label={t("settings.sections")} className="flex flex-col gap-1">
              {SETTINGS_SECTIONS.map((section) => {
                const active = activeSection === section;
                return (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={[
                      "flex h-9 w-full items-center justify-center rounded-vdu text-sm font-medium",
                      "outline-none",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                      active
                        ? "bg-vdu-accent-wash-strong text-vdu-fg"
                        : "text-vdu-fg-muted hover:bg-vdu-bg-hover hover:text-vdu-fg",
                    ].join(" ")}
                    onClick={() => selectSection(section)}
                  >
                    {t(SECTION_LABEL_KEY[section])}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* The one scroll region (VdScrollArea, 021-A): switching sections
              animates the pane content only — never the window. The stable
              scrollbar gutter keeps the pane from resizing when long content
              first becomes scrollable. */}
          <VdScrollArea
            axis="y"
            ref={settingsPaneRef}
            className="min-h-0 min-w-0 flex-1"
            data-vd-wheel-scope="local"
            data-settings-pane=""
          >
            <div
              ref={paneRef}
              role="tabpanel"
              data-settings-section={activeSection}
              className="flex flex-col gap-7 p-6"
            >
              {activeSection === "appearance" ? (
                <AppearanceSection
                  draft={draft}
                  updateAppearance={updateAppearance}
                  workspace={workspace}
                  activeSectionId={activeSectionId}
                  backgroundScope={backgroundScope}
                  onBackgroundScopeChange={setBackgroundScope}
                  updateBackground={updateBackground}
                  backgroundImage={backgroundImage}
                  onChooseImage={() => fileInputRef.current?.click()}
                  onBackgroundImageChange={setBackgroundImage}
                  backgroundBusy={backgroundBusy}
                  backgroundError={backgroundError}
                  onBackgroundErrorChange={setBackgroundError}
                  onWallpaperPresetPicked={() => {
                    // Picking a preset releases a pending custom image.
                    if (backgroundImage !== null) {
                      URL.revokeObjectURL(backgroundImage.previewUrl);
                      setBackgroundImage(null);
                    }
                  }}
                />
              ) : activeSection === "layout" ? (
                <LayoutSection
                  workspace={workspace}
                  draft={draft}
                  updateLayout={updateLayout}
                />
              ) : (
                <GeneralSection workspace={workspace} locale={locale} updateLocale={updateLocale} />
              )}
            </div>
          </VdScrollArea>
        </div>

        {/* Fixed footer row (60px, grid-owned): status left, Cancel + Save. The old
            "Up to date" pseudo-status is gone — there is no update
            subsystem; a clean draft simply shows nothing. */}
        <footer className="flex min-h-0 items-center justify-end gap-2.5 overflow-hidden border-t border-vdu-border px-5">
          {error !== null ? (
            <p className="mr-auto text-xs text-vdu-danger" role="alert">
              {error}
            </p>
          ) : busy ? (
            <p className="mr-auto text-xs text-vdu-fg-muted" aria-live="polite">
              {t("settings.saving")}
            </p>
          ) : dirty ? (
            <p className="mr-auto text-xs text-vdu-fg-muted" aria-live="polite">
              {t("settings.unsavedChanges")}
            </p>
          ) : null}
          <Button
            variant="ghost"
            onPress={onClose}
            isDisabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onPress={() => void handleSave()}
            isDisabled={!dirty || busy}
          >
            {busy ? t("settings.saving") : t("common.save")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** One settings row: title (+optional hint) left, control right. */
function SettingsRow({
  title,
  hint,
  htmlFor,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly htmlFor?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(200px,1fr)_minmax(240px,320px)] items-center gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-vdu-fg">
          {title}
        </label>
        {hint !== undefined ? (
          <p className="mt-1 text-xs leading-relaxed text-vdu-fg-muted">{hint}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

function AppearanceSection({
  draft,
  updateAppearance,
  workspace,
  activeSectionId,
  backgroundScope,
  onBackgroundScopeChange,
  updateBackground,
  backgroundImage,
  onChooseImage,
  onBackgroundImageChange,
  backgroundBusy,
  backgroundError,
  onBackgroundErrorChange,
  onWallpaperPresetPicked,
}: {
  readonly draft: WorkspaceSettingsDraft;
  readonly updateAppearance: (patch: Partial<WorkspaceAppearancePreferences>) => void;
  readonly workspace: WorkspaceSnapshot;
  readonly activeSectionId: DesktopPageId | null;
  readonly backgroundScope: "workspace" | DesktopPageId;
  readonly onBackgroundScopeChange: (scope: "workspace" | DesktopPageId) => void;
  readonly updateBackground: (patch: Partial<WorkspaceSettingsDraft["background"]>) => void;
  readonly backgroundImage: PreparedWallpaperImage | null;
  readonly onChooseImage: () => void;
  readonly onBackgroundImageChange: (image: PreparedWallpaperImage | null) => void;
  readonly backgroundBusy: boolean;
  readonly backgroundError: string | null;
  readonly onBackgroundErrorChange: (error: string | null) => void;
  readonly onWallpaperPresetPicked: () => void;
}) {
  const { t } = useI18n();
  const [customOpen, setCustomOpen] = useState(false);
  const [customHex, setCustomHex] = useState("#5b8def");
  // The draft model guarantees a style (the initializer infers one); the
  // type stays optional because legacy snapshots have none persisted.
  const selectedStyle: WorkspaceInterfaceStyle =
    draft.appearance.interfaceStyle ?? inferInterfaceStyle(draft.appearance);

  return (
    <div className="flex flex-col gap-7">
      <SettingsRow title={t("settings.colorMode")} hint={t("settings.colorMode.hint")}>
        <ToggleButtonGroup
          selectionMode="single"
          selectedKeys={new Set([draft.appearance.colorMode])}
          onSelectionChange={(keys) => {
            const value = [...keys][0];
            if (typeof value === "string") {
              updateAppearance({ colorMode: value as WorkspaceColorMode });
            }
          }}
          aria-label={t("settings.colorMode")}
        >
          {COLOR_MODE_OPTIONS.map((option) => (
            <ToggleButton key={option.value} id={option.value}>
              {t(option.labelKey)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SettingsRow>

      {/* Accent: curated swatches first, custom picker second. No raw
          hue-degree slider anywhere (019-D §5). */}
      <SettingsRow title={t("settings.accentColor")} hint={t("settings.accentColor.hint")}>
        <div className="flex items-center gap-2">
          {ACCENT_SWATCH_HUES.map((hue) => {
            const selected = draft.appearance.accentHue === hue;
            return (
              <button
                key={hue}
                type="button"
                aria-label={t(`settings.accent.${hue}` as TranslationKey)}
                aria-pressed={selected}
                className={[
                  "size-8 shrink-0 rounded-full outline-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                  selected
                    ? "ring-2 ring-vdu-fg ring-offset-2 ring-offset-vdu-bg"
                    : "ring-1 ring-vdu-border-strong",
                ].join(" ")}
                style={{ background: `oklch(0.72 0.14 ${hue})` }}
                onClick={() => updateAppearance({ accentHue: hue })}
              />
            );
          })}
          <Popover
            open={customOpen}
            onOpenChange={(open) => {
              setCustomOpen(open);
              if (open) {
                // Seed the picker from the currently selected hue.
                setCustomHex(hexFromHue(draft.appearance.accentHue));
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("settings.accent.custom")}
                aria-pressed={!ACCENT_SWATCH_HUES.includes(draft.appearance.accentHue)}
                className={[
                  "grid size-8 shrink-0 place-items-center rounded-full outline-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                  ACCENT_SWATCH_HUES.includes(draft.appearance.accentHue)
                    ? "ring-1 ring-vdu-border-strong"
                    : "ring-2 ring-vdu-fg ring-offset-2 ring-offset-vdu-bg",
                ].join(" ")}
                style={{
                  background: `conic-gradient(oklch(0.72 0.14 0), oklch(0.72 0.14 60), oklch(0.72 0.14 120), oklch(0.72 0.14 180), oklch(0.72 0.14 240), oklch(0.72 0.14 300), oklch(0.72 0.14 360))`,
                }}
              >
                <span className="size-4 rounded-full bg-vdu-bg" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[232px] p-3">
              <div className="vdu-colorful">
                <HexColorPicker
                  color={customHex}
                  onChange={(hex) => {
                    setCustomHex(hex);
                    const hue = hueFromHex(hex);
                    if (hue !== undefined) {
                      updateAppearance({ accentHue: hue });
                    }
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </SettingsRow>

      {/* Interface style (023-B.4): ONE compact single-select — the three
          fabricated miniature-window preview cards are gone. The choice
          feeds the shared surface token resolver (a save normalizes the raw
          surface values); exactly one concise description — for the
          SELECTED choice — explains what it changes. */}
      <SettingsRow title={t("settings.interfaceStyle")} hint={t("settings.interfaceStyle.hint")}>
        <ToggleButtonGroup
          selectionMode="single"
          selectedKeys={new Set([selectedStyle])}
          onSelectionChange={(keys) => {
            const value = [...keys][0];
            if (typeof value === "string") {
              updateAppearance({ interfaceStyle: value as WorkspaceInterfaceStyle });
            }
          }}
          aria-label={t("settings.interfaceStyle")}
        >
          {INTERFACE_STYLES.map((style) => (
            <ToggleButton key={style} id={style}>
              {t(INTERFACE_STYLE_LABEL_KEY[style])}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </SettingsRow>
      <p className="-mt-4 text-xs leading-relaxed text-vdu-fg-muted" data-interface-style-hint="">
        {t(INTERFACE_STYLE_HINT_KEY[selectedStyle])}
      </p>

      <BackgroundSection
        workspace={workspace}
        activeSectionId={activeSectionId}
        draft={draft}
        scope={backgroundScope}
        onScopeChange={onBackgroundScopeChange}
        updateBackground={updateBackground}
        backgroundImage={backgroundImage}
        onChooseImage={onChooseImage}
        onImageChange={onBackgroundImageChange}
        onPresetPicked={onWallpaperPresetPicked}
        busy={backgroundBusy}
        error={backgroundError}
        onErrorChange={onBackgroundErrorChange}
      />
    </div>
  );
}

/**
 * The shared background editor (023-C.2): ONE editor for the workspace
 * default and every section, selected by an explicit scope control. The
 * workspace scope exposes the presets plus a custom image; a section
 * additionally offers Follow workspace (the absence of an override — never
 * a duplicate copy of the default). Every thumbnail renders through the
 * SAME WallpaperSurface definition as the desktop, and the section NOT on
 * screen previews by thumbnail only — the desktop never navigates away to
 * preview an unrelated section. Scope switches keep every dirty patch
 * (keyed by page id) until Save/Cancel.
 */
function BackgroundSection({
  workspace,
  activeSectionId,
  draft,
  scope,
  onScopeChange,
  updateBackground,
  backgroundImage,
  onChooseImage,
  onImageChange,
  onPresetPicked,
  busy,
  error,
  onErrorChange,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly activeSectionId: DesktopPageId | null;
  readonly draft: WorkspaceSettingsDraft;
  readonly scope: "workspace" | DesktopPageId;
  readonly onScopeChange: (scope: "workspace" | DesktopPageId) => void;
  readonly updateBackground: (patch: Partial<WorkspaceSettingsDraft["background"]>) => void;
  readonly backgroundImage: PreparedWallpaperImage | null;
  readonly onChooseImage: () => void;
  readonly onImageChange: (image: PreparedWallpaperImage | null) => void;
  readonly onPresetPicked: () => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onErrorChange: (error: string | null) => void;
}) {
  const { t } = useI18n();
  const effectiveUploadLimitMiB = EFFECTIVE_UPLOAD_LIMIT_MIB;
  const isWorkspaceScope = scope === "workspace";
  const page = isWorkspaceScope ? undefined : workspace.pages.find((p) => p.id === scope);
  const editedConfig: WallpaperConfig | null = isWorkspaceScope
    ? (draft.background.workspace === undefined ? (draft.appearance.wallpaper ?? null) : draft.background.workspace)
    : (draft.background.pages[scope] === undefined ? (page?.wallpaper ?? null) : draft.background.pages[scope]);

  // The effective preview for the CURRENT scope, with the workspace layer
  // draft applied only when the workspace scope is edited (the resolver
  // keeps a saved section override authoritative).
  const effective = resolveEffectiveWallpaper({
    page,
    pageWallpaperDraft: editedConfig,
    pageWallpaperExplicitlyInherits: !isWorkspaceScope && editedConfig === null,
    workspaceWallpaper: draft.appearance.wallpaper,
    workspaceDraft:
      isWorkspaceScope && draft.background.workspace !== undefined
        ? { config: draft.background.workspace }
        : undefined,
    legacyWorkspacePreset: draft.appearance.wallpaperPreset,
  });

  function pickPreset(config: WallpaperConfig) {
    onPresetPicked();
    if (isWorkspaceScope) {
      updateBackground({ workspace: config });
    } else {
      updateBackground({ pages: { ...draft.background.pages, [scope]: config } });
    }
  }

  function setFit(fit: WallpaperFit) {
    const current = editedConfig;
    if (current?.kind !== "asset") {
      return;
    }
    const next: WallpaperConfig = { ...current, fit };
    if (isWorkspaceScope) {
      updateBackground({ workspace: next });
    } else {
      updateBackground({ pages: { ...draft.background.pages, [scope]: next } });
    }
  }

  function removeImage() {
    if (backgroundImage !== null) {
      URL.revokeObjectURL(backgroundImage.previewUrl);
      onImageChange(null);
    }
    if (isWorkspaceScope) {
      // Workspace Remove image → back to the last valid preset/default.
      updateBackground({
        workspace: { kind: "preset", presetId: draft.appearance.wallpaperPreset },
      });
    } else {
      // Section Reset background → Follow workspace (the override is gone).
      updateBackground({ pages: { ...draft.background.pages, [scope]: null } });
    }
  }

  const activePageOverridesWorkspace =
    !isWorkspaceScope &&
    activeSectionId !== null &&
    activeSectionId !== scope &&
    draft.background.pages[activeSectionId] !== undefined;

  return (
    <div className="flex flex-col gap-5" data-testid="settings.background">
      <div className="flex flex-col gap-2">
        <span className="block text-sm font-medium text-vdu-fg">
          {t("settings.background.title")}
        </span>
        <Select
          selectedKey={scope}
          onSelectionChange={(key) => {
            if (typeof key === "string" && (key === "workspace" || workspace.pages.some((p) => p.id === key))) {
              onScopeChange(key);
              onErrorChange(null);
            }
          }}
          aria-label={t("settings.background.scope")}
          fullWidth
          variant="secondary"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="workspace" textValue={t("settings.background.workspaceDefault")}>
                {t("settings.background.workspaceDefault")}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {workspace.pages.map((p) => (
                <ListBox.Item key={p.id} id={p.id} textValue={p.name}>
                  {p.name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {!isWorkspaceScope ? (
          <p className="text-xs leading-relaxed text-vdu-fg-muted">
            {effective.provenance === "section"
              ? t("settings.background.customSection")
              : t("settings.background.followingWorkspace")}
          </p>
        ) : activePageOverridesWorkspace ? (
          <p className="text-xs leading-relaxed text-vdu-fg-muted">
            {t("settings.background.sectionOverrides")}
          </p>
        ) : null}
      </div>

      {/* Section-only: Follow workspace (inheritance), never a copy. */}
      {!isWorkspaceScope ? (
        <SettingsRow title={t("settings.background.sectionMode")} hint={t("settings.background.sectionModeHint")}>
          <ToggleButtonGroup
            selectionMode="single"
            selectedKeys={new Set([editedConfig === null ? "follow" : "custom"])}
            onSelectionChange={(keys) => {
              const value = [...keys][0];
              if (value === "follow") {
                updateBackground({ pages: { ...draft.background.pages, [scope]: null } });
              } else if (editedConfig === null) {
                pickPreset({ kind: "preset", presetId: draft.appearance.wallpaperPreset });
              }
            }}
            aria-label={t("settings.background.sectionMode")}
          >
            <ToggleButton id="follow">{t("settings.background.follow")}</ToggleButton>
            <ToggleButton id="custom">{t("settings.background.custom")}</ToggleButton>
          </ToggleButtonGroup>
        </SettingsRow>
      ) : null}

      {/* Custom image — immediately after the scope/inheritance area, so
          the entry is discoverable WITHOUT scrolling past the presets
          (023-R1). The compact art preview, fit choices, inline status and
          errors all live in this one row; no second giant preview. */}
      <div className="flex flex-col gap-2" data-testid="background-image-row">
        <span className="block text-sm font-medium text-vdu-fg">
          {t("settings.background.image")}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <WallpaperSurface
            wallpaper={
              editedConfig?.kind === "asset"
                ? { config: editedConfig, provenance: "section" }
                : { config: { kind: "preset", presetId: draft.appearance.wallpaperPreset }, provenance: "workspace" }
            }
            assetUrl={
              editedConfig?.kind === "asset" && backgroundImage !== null && backgroundImage.asset.id === editedConfig.assetId
                ? backgroundImage.previewUrl
                : null
            }
            className="vela-wallpaper-surface--thumb-art w-[168px] shrink-0"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onPress={onChooseImage} isDisabled={busy}>
                {backgroundImage === null
                  ? t("settings.background.chooseImage")
                  : t("settings.background.changeImage")}
              </Button>
              {editedConfig?.kind === "asset" || backgroundImage !== null ? (
                <Button variant="ghost" onPress={removeImage}>
                  {isWorkspaceScope
                    ? t("settings.background.removeImage")
                    : t("settings.background.resetBackground")}
                </Button>
              ) : null}
            </div>
            {editedConfig?.kind === "asset" ? (
              <ToggleButtonGroup
                selectionMode="single"
                selectedKeys={new Set([editedConfig.fit])}
                onSelectionChange={(keys) => {
                  const value = [...keys][0];
                  if (value === "cover" || value === "contain") {
                    setFit(value);
                  }
                }}
                aria-label={t("settings.background.fit")}
              >
                <ToggleButton id="cover">{t("settings.background.fitCover")}</ToggleButton>
                <ToggleButton id="contain">{t("settings.background.fitContain")}</ToggleButton>
              </ToggleButtonGroup>
            ) : null}
            {busy ? (
              <span className="text-xs text-vdu-fg-muted" role="status">
                {t("settings.background.preparing")}
              </span>
            ) : null}
            {error !== null ? (
              <span className="text-xs text-vdu-danger" role="alert">
                {error}
              </span>
            ) : null}
            <p className="text-xs leading-relaxed text-vdu-fg-muted">
              {t("settings.background.imageHint", { limit: effectiveUploadLimitMiB })}
            </p>
          </div>
        </div>
      </div>

      {/* Built-in presets — compact cards (fixed-height art band, never
          full-desktop 16:9 previews), reflowing by the content pane's own
          width (container query, no viewport media queries and no per-card
          measurement). Same WallpaperSurface painter as the desktop. */}
      <div className="flex flex-col gap-2">
        <span className="block text-sm font-medium text-vdu-fg">
          {t("settings.background.presets")}
        </span>
        <div className="vela-wallpaper-choices" data-testid="wallpaper-preset-grid">
          {WALLPAPER_OPTIONS.map((option) => {
            const selected =
              editedConfig?.kind === "preset" && editedConfig.presetId === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                className={[
                  "vela-wallpaper-choice flex flex-col gap-1.5 rounded-vdu border p-2 text-left outline-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                  selected
                    ? "border-[var(--vdu-accent)] shadow-[0_0_0_1px_var(--vdu-accent)]"
                    : "border-vdu-border hover:border-vdu-border-strong",
                ].join(" ")}
                onClick={() => pickPreset({ kind: "preset", presetId: option.value })}
                data-testid={`wallpaper-preset-${option.value}`}
              >
                <WallpaperSurface
                  wallpaper={{ config: { kind: "preset", presetId: option.value }, provenance: "workspace" }}
                  assetUrl={null}
                  className="vela-wallpaper-surface--thumb-art"
                />
                <span className="flex items-center justify-between gap-1 text-xs text-vdu-fg">
                  <span className="truncate">{t(option.labelKey)}</span>
                  {selected ? (
                    <span aria-hidden="true" className="shrink-0">
                      ✓
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LayoutSection({
  workspace,
  draft,
  updateLayout,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly draft: WorkspaceSettingsDraft;
  readonly updateLayout: (patch: Partial<Omit<WorkspaceSettingsDraft, "appearance">>) => void;
}) {
  const { t } = useI18n();
  const gapValue = Math.round(draft.gridGapPx);
  return (
    <div className="flex flex-col gap-7">
      <SettingsRow title={t("settings.defaultPage")} hint={t("settings.defaultPageHint")}>
        <Select
          value={draft.defaultPageId}
          onChange={(value) => {
            if (typeof value === "string") {
              updateLayout({ defaultPageId: value });
            }
          }}
          aria-label={t("settings.defaultPage")}
          fullWidth
          variant="secondary"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {workspace.pages.map((page) => (
                <ListBox.Item key={page.id} id={page.id} textValue={page.name}>
                  {page.name}
                  {/* Meaningful selected state (021-R1): the checkmark
                      pairs with the boundary's accent-wash selected rule. */}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </SettingsRow>

      <SettingsRow title={t("settings.startInView")} hint={t("settings.startInViewHint")}>
        <VdSwitch
          isSelected={draft.layoutLocked}
          onChange={(layoutLocked) => updateLayout({ layoutLocked })}
          aria-label={t("settings.startInView")}
        />
      </SettingsRow>

      <SettingsRow title={t("settings.gridGap")} hint={t("settings.gridGapHint")}>
        <div className="flex w-full items-center gap-3">
          <Button
            variant="secondary"
            aria-label={`${t("settings.gridGap")} −${GRID_GAP_STEP_PX}`}
            isDisabled={gapValue - GRID_GAP_STEP_PX < MIN_GRID_GAP_PX}
            className="size-8 min-w-0 shrink-0 px-0"
            onPress={() => updateLayout({ gridGapPx: Math.max(MIN_GRID_GAP_PX, gapValue - GRID_GAP_STEP_PX) })}
          >
            <Minus size={14} />
          </Button>
          <Slider
            aria-label={t("settings.gridGap")}
            minValue={MIN_GRID_GAP_PX}
            maxValue={MAX_GRID_GAP_PX}
            step={GRID_GAP_STEP_PX}
            value={gapValue}
            onChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value;
              if (next !== undefined) {
                updateLayout({ gridGapPx: next });
              }
            }}
            className="flex-1"
          >
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
          <Button
            variant="secondary"
            aria-label={`${t("settings.gridGap")} +${GRID_GAP_STEP_PX}`}
            isDisabled={gapValue + GRID_GAP_STEP_PX > MAX_GRID_GAP_PX}
            className="size-8 min-w-0 shrink-0 px-0"
            onPress={() => updateLayout({ gridGapPx: Math.min(MAX_GRID_GAP_PX, gapValue + GRID_GAP_STEP_PX) })}
          >
            <Plus size={14} />
          </Button>
          <output className="w-12 text-right font-mono text-xs text-vdu-fg-muted">
            {gapValue}px
          </output>
        </div>
      </SettingsRow>
    </div>
  );
}

function GeneralSection({
  workspace,
  locale,
  updateLocale,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly locale: UiLocale;
  readonly updateLocale: (next: UiLocale) => void;
}) {
  const { t } = useI18n();
  const [importOpen, setImportOpen] = useState(false);
  const [promptStatus, setPromptStatus] = useState<"idle" | "copied" | "failed">("idle");
  const dataActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (promptStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setPromptStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [promptStatus]);

  async function handleCopyPrompt(): Promise<void> {
    const copied = await copyTextToClipboard(buildImportAiPrompt(locale));
    setPromptStatus(copied ? "copied" : "failed");
  }

  /** Closing the import overlay returns focus to its Import JSON trigger. */
  function closeImport(): void {
    setImportOpen(false);
    window.setTimeout(() => {
      dataActionsRef.current
        ?.querySelector<HTMLElement>("[data-import-json-trigger]")
        ?.focus();
    }, 0);
  }

  return (
    <div className="flex flex-col gap-7">
      <SettingsRow title={t("settings.language")} hint={t("settings.language.hint")}>
        <ToggleButtonGroup
          selectionMode="single"
          selectedKeys={new Set([locale])}
          onSelectionChange={(keys) => {
            const value = [...keys][0];
            if (typeof value === "string") {
              updateLocale(value as UiLocale);
            }
          }}
          aria-label={t("settings.language")}
        >
          {/* Endonyms by design: 中文 and English read natively in every locale. */}
          <ToggleButton id="zh-CN">{t("settings.language.chinese")}</ToggleButton>
          <ToggleButton id="en-US">{t("settings.language.english")}</ToggleButton>
        </ToggleButtonGroup>
      </SettingsRow>

      {/* Data (task 024): AI-friendly bulk import. The three actions never
          write the workspace — only the import dialog's confirmed Import
          does, through one staged revision. */}
      <SettingsRow title={t("settings.data.import")} hint={t("settings.data.import.hint")}>
        <div
          className="flex flex-wrap items-center justify-end gap-2"
          data-settings-data-actions=""
          ref={dataActionsRef}
        >
          <Button size="sm" variant="secondary" onPress={() => downloadVelaDeskImportTemplate()}>
            {t("settings.data.downloadTemplate")}
          </Button>
          <Button size="sm" variant="secondary" onPress={() => void handleCopyPrompt()}>
            {t("settings.data.copyPrompt")}
          </Button>
          <Button size="sm" variant="primary" onPress={() => setImportOpen(true)} data-import-json-trigger="">
            {t("settings.data.importJson")}
          </Button>
        </div>
      </SettingsRow>
      <p className="text-xs leading-relaxed text-vdu-fg-muted">{t("settings.data.formatNote")}</p>
      <p className="text-xs text-vdu-fg-muted" aria-live="polite">
        {promptStatus === "copied"
          ? t("settings.data.promptCopied")
          : promptStatus === "failed"
            ? t("settings.data.copyFailed")
            : ""}
      </p>

      <SettingsRow title={t("settings.version")}>
        <span className="font-mono text-xs text-vdu-fg-muted" data-veladesk-version="">
          {VELADESK_VERSION}
        </span>
      </SettingsRow>

      {importOpen ? <ImportJsonDialog workspace={workspace} onClose={closeImport} /> : null}
    </div>
  );
}
