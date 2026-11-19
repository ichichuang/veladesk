"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Select, ListBox, Slider, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { Minus, Plus } from "lucide-react";
import { HexColorPicker } from "react-colorful";
import {
  MAX_GRID_GAP_PX,
  MAX_HELM_CLOCK_SIZE_PX,
  MAX_HELM_DATE_SIZE_PX,
  MIN_GRID_GAP_PX,
  MIN_HELM_CLOCK_SIZE_PX,
  MIN_HELM_DATE_SIZE_PX,
  GRID_GAP_STEP_PX,
  INTERFACE_STYLES,
  inferInterfaceStyle,
} from "@veladesk/domain";
import type {
  DesktopPageId,
  PageHelmClockOverride,
  WorkspaceAppearancePreferences,
  WorkspaceColorMode,
  WorkspaceInterfaceStyle,
  WorkspaceSnapshot,
} from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import type { UiLocale } from "../i18n/locale";
import type { TranslationKey } from "../i18n/messages";
import type { WorkspaceSettingsDraft } from "./settings-draft";
import { ACCENT_SWATCH_HUES, hexFromHue, hueFromHex } from "./accent-color";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { BackgroundSection, type BackgroundLayer } from "./settings-background";
import type { PreparedWallpaperImage } from "./wallpaper-prep";
import { VdSwitch } from "@components/vd/switch";
import { ColorField } from "@components/vd/color-popover";
import { VELADESK_VERSION } from "../../lib/app-version";
import { buildImportAiPrompt } from "../import-json/ai-prompt";
import { copyTextToClipboard } from "../import-json/clipboard";
import { downloadVelaDeskImportTemplate } from "../import-json/template";
import { prepareWorkspaceRecipe, type PreparedRecipeExport, downloadWorkspaceRecipe } from "../import-json/recipe-file";
import { ImportJsonDialog } from "../import-json/import-json-dialog";
import { EngineeringChangePasswordDialog } from "../engineering/engineering-change-password-dialog";
import {
  COLOR_MODE_OPTIONS,
  INTERFACE_STYLE_HINT_KEY,
  INTERFACE_STYLE_LABEL_KEY,
  SettingsRow,
} from "./settings-shared";

/** The appearance tab: color mode, accent, interface style, background. */
export function AppearanceSection({
  draft,
  updateAppearance,
  workspace,
  activeSectionId,
  backgroundScope,
  backgroundLayer,
  onBackgroundScopeChange,
  onBackgroundLayerChange,
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
  readonly backgroundLayer: BackgroundLayer;
  readonly onBackgroundScopeChange: (scope: "workspace" | DesktopPageId) => void;
  readonly onBackgroundLayerChange: (layer: BackgroundLayer) => void;
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
  // task 028: the custom accent dot is "active" exactly while the full
  // color override rules — no more guessing from the hue alone.
  const customSelected = draft.appearance.accentColor !== undefined;

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
            // task 028: a curated swatch is "selected" only while the
            // custom override is clear — otherwise it would light up
            // while a user-picked color is showing.
            const selected =
              draft.appearance.accentHue === hue && draft.appearance.accentColor === undefined;
            return (
              <button
                key={hue}
                type="button"
                aria-label={t(`settings.accent.${hue}` as TranslationKey)}
                aria-pressed={selected}
                className={[
                  "size-8 shrink-0 rounded-full outline-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                  // The selection ring is a box-shadow — transition it so the
                  // ring glides in instead of popping (settings motion audit;
                  // A13: the duration reads the token, never a literal).
                  "transition-[box-shadow,background-color] duration-[var(--vd-motion-control)] ease-[var(--vd-motion-ease)]",
                  selected
                    ? "ring-2 ring-vdu-fg ring-offset-2 ring-offset-vdu-bg"
                    : "ring-1 ring-vdu-border-strong",
                ].join(" ")}
                style={{ background: `oklch(0.72 0.14 ${hue})` }}
                onClick={() => {
                  // exactOptionalPropertyTypes: CLEAR the custom override
                  // by rebuilding the appearance without the key.
                  const { accentColor: _drop, ...rest } = draft.appearance;
                  void _drop;
                  updateAppearance({ ...rest, accentHue: hue });
                }}
              />
            );
          })}
          <Popover
            open={customOpen}
            onOpenChange={(open) => {
              setCustomOpen(open);
              if (open) {
                // Seed from the persisted custom color, else the hue tone.
                setCustomHex(
                  draft.appearance.accentColor ?? hexFromHue(draft.appearance.accentHue)
                );
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("settings.accent.custom")}
                aria-pressed={customSelected}
                className={[
                  "grid size-8 shrink-0 place-items-center rounded-full outline-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                  customSelected
                    ? "ring-2 ring-vdu-fg ring-offset-2 ring-offset-vdu-bg"
                    : "ring-1 ring-vdu-border-strong",
                ].join(" ")}
                style={{
                  // task 028: while a custom color rules, the dot shows IT
                  // (what you see is what you picked); otherwise the hue
                  // wheel hints the picker.
                  background: customSelected
                    ? (draft.appearance.accentColor ?? "#888888")
                    : `conic-gradient(oklch(0.72 0.14 0), oklch(0.72 0.14 60), oklch(0.72 0.14 120), oklch(0.72 0.14 180), oklch(0.72 0.14 240), oklch(0.72 0.14 300), oklch(0.72 0.14 360))`,
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
                    // task 028: the FULL picked color applies (accentColor
                    // override); the hue stays in sync so the curated
                    // swatch row and the conic dot keep a sensible base.
                    const hue = hueFromHex(hex);
                    updateAppearance({
                      accentHue: hue ?? draft.appearance.accentHue,
                      accentColor: hex.toLowerCase(),
                    });
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
        layer={backgroundLayer}
        onScopeChange={onBackgroundScopeChange}
        onLayerChange={onBackgroundLayerChange}
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
 * The 分区 (sections) tab (task 029 follow-up IA split): the per-section
 * desktop structure settings — the helm clock/date presentation (global or
 * per-section) and the block visibility switches. These left the appearance
 * tab so 外观 stays color/material/background while everything that shapes
 * the SECTION desktop lives together. Both ride the same draft → live
 * preview → Save chain as before; only the tab placement changed.
 */
export function SectionsSection({
  workspace,
  draft,
  updateAppearance,
  helmClockScope,
  onHelmClockScopeChange,
  updateHelmClockPage,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly draft: WorkspaceSettingsDraft;
  readonly updateAppearance: (patch: Partial<WorkspaceAppearancePreferences>) => void;
  readonly helmClockScope: "workspace" | DesktopPageId;
  readonly onHelmClockScopeChange: (scope: "workspace" | DesktopPageId) => void;
  readonly updateHelmClockPage: (pageId: DesktopPageId, override: PageHelmClockOverride | null) => void;
}) {
  return (
    <div className="flex flex-col gap-7" data-settings-sections-tab="">
      <HelmClockSection
        workspace={workspace}
        draft={draft}
        updateAppearance={updateAppearance}
        scope={helmClockScope}
        onScopeChange={onHelmClockScopeChange}
        updatePage={updateHelmClockPage}
      />

      <BlockVisibilitySection draft={draft} updateAppearance={updateAppearance} />
    </div>
  );
}

/** The appearance fields one block-visibility switch writes (task 029). */
type AppearanceBlockVisibilityField =
  | "showHelmClock"
  | "showHelmDate"
  | "showCommandBar"
  | "showDock"
  | "showSectionPill";

/**
 * Block visibility (task 029 区块显示): free per-block show/hide for the
 * desktop's always-present chrome — clock, date, ⌘K search bar, dock and
 * the section pill. Switches write plain booleans into the appearance
 * draft (absent = shown), so the t148 live preview hides/shows each block
 * on the real desktop immediately and Save persists with the rest.
 */
function BlockVisibilitySection({
  draft,
  updateAppearance,
}: {
  readonly draft: WorkspaceSettingsDraft;
  readonly updateAppearance: (patch: Partial<WorkspaceAppearancePreferences>) => void;
}) {
  const { t } = useI18n();
  const rows: readonly { readonly field: AppearanceBlockVisibilityField; readonly key: TranslationKey }[] =
    [
      { field: "showHelmClock", key: "settings.blocks.helmClock" },
      { field: "showHelmDate", key: "settings.blocks.helmDate" },
      { field: "showCommandBar", key: "settings.blocks.commandBar" },
      { field: "showDock", key: "settings.blocks.dock" },
      { field: "showSectionPill", key: "settings.blocks.sectionPill" },
    ];
  return (
    <div className="flex flex-col gap-4" data-settings-block-visibility="">
      {/* Section heading (a SettingsRow always carries its control on the
          right; this group heading has none, so it uses the row's left
          column markup directly). */}
      <div className="min-w-0">
        <p className="block text-sm font-medium text-vdu-fg">{t("settings.blocks.title")}</p>
        <p className="mt-1 text-xs leading-relaxed text-vdu-fg-muted">
          {t("settings.blocks.title.hint")}
        </p>
      </div>
      {rows.map((row) => (
        <SettingsRow key={row.field} title={t(row.key)}>
          <VdSwitch
            isSelected={draft.appearance[row.field] !== false}
            onChange={(visible) => updateAppearance({ [row.field]: visible })}
            aria-label={t(row.key)}
          />
        </SettingsRow>
      ))}
    </div>
  );
}

/**
 * The clock/date presentation block (task 028): the workspace fields are
 * plain appearance controls; switching the scope to a section edits that
 * section's override instead (absent fields follow the workspace, the
 * explicit "follow global" action removes the whole override). The live
 * desktop preview resolves the VISIBLE section's effective values, so
 * every drag shows immediately on the real clock.
 */
function HelmClockSection({
  workspace,
  draft,
  updateAppearance,
  scope,
  onScopeChange,
  updatePage,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly draft: WorkspaceSettingsDraft;
  readonly updateAppearance: (patch: Partial<WorkspaceAppearancePreferences>) => void;
  readonly scope: "workspace" | DesktopPageId;
  readonly onScopeChange: (scope: "workspace" | DesktopPageId) => void;
  readonly updatePage: (pageId: DesktopPageId, override: PageHelmClockOverride | null) => void;
}) {
  const { t } = useI18n();
  const pagePatch =
    scope === "workspace" ? undefined : draft.helmClock.pages[scope];

  function setClockSize(value: number) {
    if (scope === "workspace") {
      updateAppearance({ helmClockSizePx: value });
    } else {
      updatePage(scope, { ...(pagePatch ?? {}), clockSizePx: value });
    }
  }
  function setClockColor(value: string | undefined) {
    if (scope === "workspace") {
      // exactOptionalPropertyTypes: explicit undefined CLEARs the field.
      if (value === undefined) {
        const { helmClockColor: _drop, ...rest } = draft.appearance;
        void _drop;
        updateAppearance(rest);
      } else {
        updateAppearance({ helmClockColor: value });
      }
    } else {
      updatePage(scope, withPageField(pagePatch, "clockColor", value));
    }
  }
  function setDateSize(value: number) {
    if (scope === "workspace") {
      updateAppearance({ helmDateSizePx: value });
    } else {
      updatePage(scope, { ...(pagePatch ?? {}), dateSizePx: value });
    }
  }
  function setDateColor(value: string | undefined) {
    if (scope === "workspace") {
      if (value === undefined) {
        const { helmDateColor: _drop, ...rest } = draft.appearance;
        void _drop;
        updateAppearance(rest);
      } else {
        updateAppearance({ helmDateColor: value });
      }
    } else {
      updatePage(scope, withPageField(pagePatch, "dateColor", value));
    }
  }

  const clockSize = scope === "workspace" ? draft.appearance.helmClockSizePx : pagePatch?.clockSizePx;
  const clockColor = scope === "workspace" ? draft.appearance.helmClockColor : pagePatch?.clockColor;
  const dateSize = scope === "workspace" ? draft.appearance.helmDateSizePx : pagePatch?.dateSizePx;
  const dateColor = scope === "workspace" ? draft.appearance.helmDateColor : pagePatch?.dateColor;

  return (
    <div className="flex flex-col gap-5" data-settings-helm-clock="">
      <SettingsRow title={t("settings.helmClock.title")} hint={t("settings.helmClock.title.hint")}>
        <Select
          value={scope === "workspace" ? "workspace" : scope}
          onChange={(value) => {
            if (value === "workspace" || typeof value === "string") {
              onScopeChange(value === "workspace" ? "workspace" : (value as DesktopPageId));
            }
          }}
          aria-label={t("settings.helmClock.scope")}
          variant="secondary"
          className="w-[220px]"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="workspace" textValue={t("settings.helmClock.scope.workspace")}>
                {t("settings.helmClock.scope.workspace")}
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {workspace.pages.map((page) => (
                <ListBox.Item key={page.id} id={page.id} textValue={page.name}>
                  {page.name}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </SettingsRow>

      {/* friendly-ui stability contract: follow-vs-override state reads from
          the CONTROLS themselves (every field showing 自动 = following) — a
          conditional status line here would appear/disappear and shift the
          rows below. */}

      <div className="flex flex-col gap-4">
        <HelmClockSizeRow
          label={t("settings.helmClock.clockSize")}
          value={clockSize}
          fallback={60}
          min={MIN_HELM_CLOCK_SIZE_PX}
          max={MAX_HELM_CLOCK_SIZE_PX}
          ariaLabel={t("settings.helmClock.clockSize")}
          autoLabel={t("settings.helmClock.auto")}
          onChange={setClockSize}
          onAuto={() => {
            if (scope === "workspace") {
              const { helmClockSizePx: _drop, ...rest } = draft.appearance;
              void _drop;
              updateAppearance(rest);
            } else {
              updatePage(scope, withPageField(pagePatch, "clockSizePx", undefined));
            }
          }}
        />
        <SettingsRow title={t("settings.helmClock.clockColor")}>
          <ColorField
            label={t("settings.helmClock.clockColor")}
            autoLabel={t("settings.helmClock.auto")}
            swatchAriaLabel={clockColor ?? t("settings.helmClock.auto")}
            value={clockColor}
            onChange={setClockColor}
            className="min-w-0 flex-1"
          />
        </SettingsRow>
        <HelmClockSizeRow
          label={t("settings.helmClock.dateSize")}
          value={dateSize}
          fallback={14}
          min={MIN_HELM_DATE_SIZE_PX}
          max={MAX_HELM_DATE_SIZE_PX}
          ariaLabel={t("settings.helmClock.dateSize")}
          autoLabel={t("settings.helmClock.auto")}
          onChange={setDateSize}
          onAuto={() => {
            if (scope === "workspace") {
              const { helmDateSizePx: _drop, ...rest } = draft.appearance;
              void _drop;
              updateAppearance(rest);
            } else {
              updatePage(scope, withPageField(pagePatch, "dateSizePx", undefined));
            }
          }}
        />
        <SettingsRow title={t("settings.helmClock.dateColor")}>
          <ColorField
            label={t("settings.helmClock.dateColor")}
            autoLabel={t("settings.helmClock.auto")}
            swatchAriaLabel={dateColor ?? t("settings.helmClock.auto")}
            value={dateColor}
            onChange={setDateColor}
            className="min-w-0 flex-1"
          />
        </SettingsRow>
      </div>
    </div>
  );
}

/** One size row: − / slider / + with an Auto reset, px output (task 028). */
function HelmClockSizeRow({
  label,
  value,
  fallback,
  min,
  max,
  ariaLabel,
  autoLabel,
  onChange,
  onAuto,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
  readonly ariaLabel: string;
  readonly autoLabel: string;
  readonly onChange: (value: number) => void;
  readonly onAuto: () => void;
}) {
  const shown = value ?? fallback;
  return (
    <SettingsRow title={label}>
      <div className="flex w-full items-center gap-3">
        <button
          type="button"
          className="rounded-vdu px-2 py-1 text-xs font-medium text-vdu-fg-muted outline-none hover:bg-vdu-bg-hover hover:text-vdu-fg disabled:pointer-events-none disabled:opacity-50"
          disabled={value === undefined}
          onClick={onAuto}
        >
          {autoLabel}
        </button>
        <Slider
          aria-label={ariaLabel}
          minValue={min}
          maxValue={max}
          step={1}
          value={shown}
          onChange={(next) => {
            const resolved = Array.isArray(next) ? next[0] : next;
            if (resolved !== undefined) {
              onChange(resolved);
            }
          }}
          className="flex-1"
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <output className="w-12 text-right font-mono text-xs text-vdu-fg-muted">
          {shown}px
        </output>
      </div>
    </SettingsRow>
  );
}

/** The layout tab: default section, start mode, grid gap. */
export function LayoutSection({
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

/** The general tab: language, motion experiments, data import/export, version. */
export function GeneralSection({
  workspace,
  locale,
  updateLocale,
  draft,
  updateMotionExperiment,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly locale: UiLocale;
  readonly updateLocale: (next: UiLocale) => void;
  readonly draft: WorkspaceSettingsDraft;
  readonly updateMotionExperiment: (patch: { readonly helmMotion?: boolean }) => void;
}) {
  const { t } = useI18n();
  const [importOpen, setImportOpen] = useState(false);
  /** t181: the 修改密码 dialog (Engineering-mode password). */
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [promptStatus, setPromptStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [embedWallpapers, setEmbedWallpapers] = useState(false);
  const [preparedExport, setPreparedExport] = useState<{ workspace: WorkspaceSnapshot; file: PreparedRecipeExport }>();
  const [exportFailed, setExportFailed] = useState(false);
  const exportReady = preparedExport?.workspace === workspace ? preparedExport.file : undefined;
  useEffect(() => {
    if (!embedWallpapers) return;
    let cancelled = false;
    void prepareWorkspaceRecipe(workspace, { embedWallpapers: true }).then((file) => {
      if (!cancelled) setPreparedExport({ workspace, file });
    }).catch(() => {
      if (!cancelled) setExportFailed(true);
    });
    return () => { cancelled = true; };
  }, [embedWallpapers, workspace]);
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

      {/* Motion experiments (P1): the single helmMotion master switch —
          gates ONLY the Orbits/Wake prototypes. The Dawn opening is an
          official moment, on by default, and not tied to this switch.
          Reduced motion always wins over this flag; the hint says so. */}
      <SettingsRow title={t("settings.motion")} hint={t("settings.motion.hint")}>
        <VdSwitch
          isSelected={draft.motion?.experiments?.helmMotion === true}
          onChange={(helmMotion) => updateMotionExperiment({ helmMotion })}
          aria-label={t("settings.motion")}
        />
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
          {/* RecipeV1 (P1): export the public deck config — also readable by
              the import flow above. Never writes the workspace. */}
          <Button size="sm" variant="secondary" isDisabled={embedWallpapers && !exportReady} onPress={() => downloadWorkspaceRecipe(workspace, embedWallpapers ? exportReady : undefined)}>
            {t("settings.data.exportDeck")}
          </Button>
          <Button size="sm" variant="primary" onPress={() => setImportOpen(true)} data-import-json-trigger="">
            {t("settings.data.importJson")}
          </Button>
        </div>
      </SettingsRow>
      <SettingsRow title={t("settings.data.embedWallpapers")}>
        <VdSwitch isSelected={embedWallpapers} onChange={(value) => {
          setPreparedExport(undefined);
          setExportFailed(false);
          setEmbedWallpapers(value);
        }} aria-label={t("settings.data.embedWallpapers")} />
      </SettingsRow>
      <p className="text-xs text-vdu-fg-muted" aria-live="polite">
        {embedWallpapers ? exportFailed ? t("settings.data.exportFailed") : exportReady
          ? t("settings.data.exportSize", { size: (exportReady.byteLength / (1024 * 1024)).toFixed(2) })
          : t("settings.data.exportPreparing") : ""}
      </p>
      <p className="text-xs text-vdu-fg-muted break-all" aria-live="polite">
        {embedWallpapers && exportReady?.skipped.length ? t("settings.data.exportSkipped", {
          assets: exportReady.skipped.map(({ id, reason }) => `${id} (${t(`settings.data.exportReason.${reason}` as TranslationKey)})`).join("; "),
        }) : ""}
      </p>
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

      {/* t181: the Engineering-mode password lives behind Settings (which
          only Engineering mode can open). Changing it requires the current
          password, re-verified server-side. */}
      <SettingsRow
        title={t("engineering.settings.rowTitle")}
        hint={t("engineering.settings.rowHint")}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              setPasswordChanged(false);
              setPasswordChangeOpen(true);
            }}
            data-engineering-change-password=""
          >
            {t("engineering.settings.changeAction")}
          </Button>
        </div>
      </SettingsRow>
      <p className="text-xs text-vdu-fg-muted" aria-live="polite">
        {passwordChanged ? t("engineering.password.changed") : ""}
      </p>

      {importOpen ? <ImportJsonDialog workspace={workspace} onClose={closeImport} /> : null}
      {passwordChangeOpen ? (
        <EngineeringChangePasswordDialog
          open
          onClose={() => setPasswordChangeOpen(false)}
          onSaved={() => {
            setPasswordChangeOpen(false);
            setPasswordChanged(true);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * exactOptionalPropertyTypes bridge (task 028): builds the next page
 * override with ONE field set — `undefined` REMOVES the field (it then
 * follows the workspace) instead of writing an explicit undefined key.
 */
function withPageField(
  base: PageHelmClockOverride | null | undefined,
  field: "clockSizePx" | "clockColor" | "dateSizePx" | "dateColor",
  value: number | string | undefined
): PageHelmClockOverride {
  const next: Record<string, number | string | undefined> = { ...(base ?? {}) };
  if (value === undefined) {
    delete next[field];
  } else {
    next[field] = value;
  }
  return next as PageHelmClockOverride;
}
