"use client";

import { Button, Select, ListBox, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { resolveModeAwareWallpaper } from "@veladesk/domain";
import type {
  DesktopPageId,
  WallpaperConfig,
  WallpaperFit,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import { MAX_ASSET_BYTES } from "@veladesk/assets/core";

import { useI18n } from "../i18n/use-i18n";
import type { WorkspaceSettingsDraft } from "./settings-draft";
import { BackgroundImageThumbnail } from "./background-image-thumbnail";
import { WallpaperSurface } from "./desktop-wallpaper";
import type { PreparedWallpaperImage } from "./wallpaper-prep";
import { SettingsRow, WALLPAPER_OPTIONS } from "./settings-shared";

/** Which layer of a section's background the editor edits (P1). */
export type BackgroundLayer = "general" | "light" | "dark";

/**
 * The shared background editor (023-C.2): ONE editor for the workspace
 * default and every section, selected by an explicit scope control. The
 * workspace scope exposes the presets plus a custom image; a section
 * additionally offers Follow workspace (the absence of an override — never
 * a duplicate copy of the default) and, since P1, per-COLOR-MODE layers:
 * the mode-agnostic upload, or a separate light/dark image whose absence
 * falls back to it. Every thumbnail renders through the SAME
 * WallpaperSurface definition as the desktop, and the section NOT on
 * screen previews by thumbnail only — the desktop never navigates away to
 * preview an unrelated section. Scope/layer switches keep every dirty
 * patch (keyed by page id) until Save/Cancel.
 */
export function BackgroundSection({
  workspace,
  activeSectionId,
  draft,
  scope,
  layer,
  onScopeChange,
  onLayerChange,
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
  /** The edited per-mode layer (sections only; `general` elsewhere). */
  readonly layer: BackgroundLayer;
  readonly onScopeChange: (scope: "workspace" | DesktopPageId) => void;
  readonly onLayerChange: (layer: BackgroundLayer) => void;
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
  const isWorkspaceScope = scope === "workspace";
  const page = isWorkspaceScope ? undefined : workspace.pages.find((p) => p.id === scope);
  const patch = isWorkspaceScope ? undefined : draft.background.pages[scope];
  const editingModeLayer = !isWorkspaceScope && layer !== "general";

  /** The edited layer's config: the draft value, else the persisted one. */
  const editedConfig: WallpaperConfig | null = isWorkspaceScope
    ? (draft.background.workspace === undefined ? (draft.appearance.wallpaper ?? null) : draft.background.workspace)
    : layer === "general"
      ? (patch?.general === undefined ? (page?.wallpaper ?? null) : patch.general)
      : (patch?.[layer] === undefined ? (page?.wallpaperByMode?.[layer] ?? null) : patch?.[layer] ?? null);

  // The effective preview for the CURRENT scope, with the workspace layer
  // draft applied only when the workspace scope is edited (the resolver
  // keeps a saved section override authoritative).
  const effective = resolveModeAwareWallpaper(
    {
      effectiveMode: layer === "general" ? "dark" : layer,
      page,
      modeWallpaperDraft: editingModeLayer
        ? { mode: layer, config: editedConfig }
        : { mode: "dark", config: null },
    },
    {
      page,
      pageWallpaperDraft: layer === "general" ? editedConfig : undefined,
      pageWallpaperExplicitlyInherits: !isWorkspaceScope && layer === "general" && editedConfig === null,
      workspaceWallpaper: draft.appearance.wallpaper,
      workspaceDraft:
        isWorkspaceScope && draft.background.workspace !== undefined
          ? { config: draft.background.workspace }
          : undefined,
      legacyWorkspacePreset: draft.appearance.wallpaperPreset,
    },
  );

  /** Writes one config into the edited layer of the edited scope. */
  function writeLayer(config: WallpaperConfig | null) {
    if (isWorkspaceScope) {
      updateBackground({ workspace: config });
      return;
    }
    const current = draft.background.pages[scope];
    const next =
      layer === "general"
        ? { ...current, general: config }
        : { ...current, [layer]: config };
    updateBackground({ pages: { ...draft.background.pages, [scope]: next } });
  }

  function pickPreset(config: WallpaperConfig) {
    onPresetPicked();
    writeLayer(config);
  }

  function setFit(fit: WallpaperFit) {
    const current = editedConfig;
    if (current?.kind !== "asset") {
      return;
    }
    writeLayer({ ...current, fit });
  }

  function removeImage() {
    if (backgroundImage !== null) {
      onImageChange(null);
    }
    if (isWorkspaceScope) {
      // Workspace Remove image → back to the last valid preset/default.
      updateBackground({
        workspace: { kind: "preset", presetId: draft.appearance.wallpaperPreset },
      });
      return;
    }
    if (editingModeLayer) {
      // Mode layer reset → the override is gone; the mode follows the
      // section's general upload again.
      writeLayer(null);
      return;
    }
    // Section Reset background → Follow workspace (the override is gone).
    writeLayer(null);
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
            {editingModeLayer
              ? editedConfig === null
                ? t("settings.background.modeFollowingGeneral")
                : t("settings.background.modeCustom")
              : effective.provenance === "section"
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
      {!isWorkspaceScope && !editingModeLayer ? (
        <SettingsRow title={t("settings.background.sectionMode")} hint={t("settings.background.sectionModeHint")}>
          <ToggleButtonGroup
            selectionMode="single"
            selectedKeys={new Set([editedConfig === null && !editingModeLayer ? "follow" : "custom"])}
            onSelectionChange={(keys) => {
              const value = [...keys][0];
              if (value === "follow") {
                writeLayer(null);
              } else if (editedConfig === null && !editingModeLayer) {
                pickPreset({ kind: "preset", presetId: "chart" });
              }
            }}
            aria-label={t("settings.background.sectionMode")}
          >
            <ToggleButton id="follow">{t("settings.background.follow")}</ToggleButton>
            <ToggleButton id="custom">{t("settings.background.custom")}</ToggleButton>
          </ToggleButtonGroup>
        </SettingsRow>
      ) : null}

      {/* Section-only (P1): WHICH layer the image controls below edit —
          the shared upload, or a dedicated light/dark image. */
      !isWorkspaceScope ? (
        <SettingsRow title={t("settings.background.layer")} hint={t("settings.background.layerHint")}>
          <ToggleButtonGroup
            selectionMode="single"
            selectedKeys={new Set([layer])}
            onSelectionChange={(keys) => {
              const value = [...keys][0];
              if (value === "general" || value === "light" || value === "dark") {
                onLayerChange(value);
              }
            }}
            aria-label={t("settings.background.layer")}
          >
            <ToggleButton id="general">{t("settings.background.layerBoth")}</ToggleButton>
            <ToggleButton id="light">{t("settings.background.layerLight")}</ToggleButton>
            <ToggleButton id="dark">{t("settings.background.layerDark")}</ToggleButton>
          </ToggleButtonGroup>
        </SettingsRow>
      ) : null}

      {/* Custom image — immediately after the scope/inheritance area, so
          the entry is discoverable WITHOUT scrolling past the presets
          (023-R1). The compact art preview, fit choices, inline status and
          errors all live in this one row; no second giant preview. */}
      <div className="flex flex-col gap-2" data-testid="background-image-row">
        <span className="block text-sm font-medium text-vdu-fg">
          {editingModeLayer
            ? layer === "light"
              ? t("settings.background.imageLight")
              : t("settings.background.imageDark")
            : t("settings.background.image")}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <BackgroundImageThumbnail config={editedConfig} pending={backgroundImage} />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onPress={onChooseImage} isDisabled={busy}>
                {backgroundImage === null && editedConfig?.kind !== "asset"
                  ? t("settings.background.chooseImage")
                  : t("settings.background.changeImage")}
              </Button>
              {editedConfig?.kind === "asset" || backgroundImage !== null ? (
                <Button variant="ghost" onPress={removeImage}>
                  {isWorkspaceScope
                    ? t("settings.background.removeImage")
                    : editingModeLayer
                      ? t("settings.background.removeModeImage")
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
              {t("settings.background.imageHint", { limit: Math.round(MAX_ASSET_BYTES / (1024 * 1024)) })}
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
