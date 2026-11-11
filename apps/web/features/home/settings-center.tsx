"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, CloseButton } from "@heroui/react";

import type {
  DesktopPageId,
  WallpaperConfig,
} from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import type { UiLocale } from "../i18n/locale";
import type { TranslationKey } from "../i18n/messages";
import {
  areWorkspaceSettingsDraftsEqual,
  createWorkspaceSettingsDraft,
} from "./settings-draft";
import type { WorkspaceSettingsDraft } from "./settings-draft";
import { Dialog, DialogContent, DialogTitle } from "@components/ui/dialog";
import { releaseWallpaperPreviewUrl } from "./desktop-wallpaper";
import {
  prepareWallpaperImage,
  type PreparedWallpaperImage,
} from "./wallpaper-prep";
import { AppearanceSection, GeneralSection, LayoutSection } from "./settings-sections";
import type { BackgroundLayer } from "./settings-background";
import { BrandLogo } from "@components/vd/brand-logo";
import { VdScrollArea } from "@components/vd/scroll-area";
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

  readonly workspace: import("@veladesk/domain").WorkspaceSnapshot;

  /**
   * Fires on every appearance control change — the LIVE DRAFT, previewed by
   * the shell on the overlay portal root ONLY (the Settings window itself
   * previews the draft; UX-07 keeps the desktop on the persisted theme
   * until Save).
   */
  readonly onPreviewAppearance: (appearance: import("@veladesk/domain").WorkspaceAppearancePreferences) => void;

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

  /** The section currently on screen — scopes the editor's layer hints. */
  readonly activeSectionId?: DesktopPageId | null | undefined;
}

type SettingsSection = "appearance" | "layout" | "general";

const SETTINGS_SECTIONS: readonly SettingsSection[] = ["appearance", "layout", "general"];

const SECTION_LABEL_KEY: Readonly<Record<SettingsSection, TranslationKey>> = {
  appearance: "settings.section.appearance",
  layout: "settings.section.layout",
  general: "settings.section.general",
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
 * The section panels (appearance/layout/general, the background editor
 * and the shared row/options) live in settings-sections.tsx,
 * settings-background.tsx and settings-shared.tsx since P1; this module
 * owns the window frame, the draft session and the background image
 * picker only. Controls are canonical HeroUI
 * components themed through the --vdu-* token bridge. Save is the only
 * staging path (UX-07: every control edits the draft — the desktop itself
 * changes only on Save; Cancel/Escape drop the draft and its preview),
 * and the interface language stays an immediate browser-local preference
 * outside the draft.
 */
export function SettingsCenter({
  open,
  workspace,
  onPreviewAppearance,
  onSave,
  onClose,
  backgroundEntrySectionId = null,
  activeSectionId = null,
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
  /** The per-mode layer the background editor edits (sections only, P1). */
  const [backgroundLayer, setBackgroundLayer] = useState<BackgroundLayer>("general");
  const [backgroundImage, setBackgroundImage] = useState<PreparedWallpaperImage | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundRequestRef = useRef(0);

  useLayoutEffect(() => {
    return () => { backgroundRequestRef.current += 1; };
  }, [open]);

  // Object-URL ownership (UX-02): while the image is only a DRAFT, this
  // session owns its preview URL and releases it on replace/close. Once a
  // Save SUCCEEDS the URL transfers to the shell's asset cache (the desktop
  // keeps rendering it) — revoking it here would black out the wallpaper.
  // The cancel path releases DELAYED (UX-07): the panel's own thumbnail and
  // any in-flight decode/crossfade finish against a live URL first.
  const transferredUrlsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    return () => {
      if (
        backgroundImage !== null &&
        !transferredUrlsRef.current.has(backgroundImage.previewUrl)
      ) {
        releaseWallpaperPreviewUrl(backgroundImage.previewUrl);
      }
    };
  }, [backgroundImage]);

  // Closing releases the pending image (its preview URL is revoked by the
  // cleanup above). Tracked as derived state on the open transition, in
  // render, rather than from an effect.
  const [imageOpenState, setImageOpenState] = useState(open);
  if (imageOpenState !== open) {
    setImageOpenState(open);
    if (!open) setBackgroundImage(null);
  }

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
      setBackgroundImage(null);
      setBackgroundError(null);
      setBackgroundBusy(false);
      setBackgroundScope(backgroundEntrySectionId ?? "workspace");
      setBackgroundLayer("general");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-transition lifecycle only
  }, [open, workspace]);

  const initialDraft = useMemo(() => createWorkspaceSettingsDraft(workspace), [workspace]);
  const dirty = !areWorkspaceSettingsDraftsEqual(draft, initialDraft);

  function updateAppearance(patch: Partial<import("@veladesk/domain").WorkspaceAppearancePreferences>) {
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
   * Motion experiment switches (P1): the helmMotion master flag rides the
   * draft's optional motion block — never live-previewed, applied on Save
   * with the rest of the preferences. Toggling merges into whatever
   * persisted block exists (or none).
   */
  function updateMotionExperiment(patch: { readonly helmMotion?: boolean }) {
    setDraft((current) => ({
      ...current,
      motion: {
        ...current.motion,
        experiments: { ...current.motion?.experiments, ...patch },
      },
    }));
    setError(null);
  }

  /**
   * (UX-07) The background draft NO LONGER streams to the desktop — every
   * settings item is draft-only now; the desktop changes on Save. The
   * editor's own renderer-based thumbnails (workspace layer, per-section
   * layer, per-mode layer) preview the draft INSIDE the panel, and Save
   * applies the whole draft atomically through the shell's transaction.
   */

  function updateBackground(patch: Partial<WorkspaceSettingsDraft["background"]>) {
    setDraft((current) => ({
      ...current,
      background: {
        ...current.background,
        ...patch,
        pages: { ...current.background.pages, ...patch.pages },
      },
    }));
    setError(null);
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
      // staged image's preview URL is TRANSFERRED to the shell's wallpaper
      // asset cache (the desktop keeps rendering it verbatim) — mark it so
      // this session's cleanup never revokes a URL a live surface shows.
      if (result.ok && backgroundImage !== null) {
        transferredUrlsRef.current = new Set([...transferredUrlsRef.current, backgroundImage.previewUrl]);
      }
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
            const request = ++backgroundRequestRef.current;
            setBackgroundBusy(true);
            setBackgroundError(null);
            void prepareWallpaperImage(file)
              .then((result) => {
                if (request !== backgroundRequestRef.current) {
                  if (result.ok) URL.revokeObjectURL(result.image.previewUrl);
                  return;
                }
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
                  const current = draft.background.pages[backgroundScope];
                  const patch =
                    backgroundLayer === "general"
                      ? { ...current, general: config }
                      : { ...current, [backgroundLayer]: config };
                  updateBackground({ pages: { [backgroundScope]: patch } });
                }
              })
              .finally(() => {
                if (request === backgroundRequestRef.current) setBackgroundBusy(false);
              });
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
              first becomes scrollable. Lenis smooth-scrolls this independent
              pane (P1) — the fixed window frame never scrolls. */}
          <VdScrollArea
            axis="y"
            smooth
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
                  backgroundLayer={backgroundLayer}
                  onBackgroundScopeChange={setBackgroundScope}
                  onBackgroundLayerChange={setBackgroundLayer}
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
                <GeneralSection
                  workspace={workspace}
                  locale={locale}
                  updateLocale={updateLocale}
                  draft={draft}
                  updateMotionExperiment={updateMotionExperiment}
                />
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
