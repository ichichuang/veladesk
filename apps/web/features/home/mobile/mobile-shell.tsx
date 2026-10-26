"use client";

import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  VdHeroOverlayScope,
  VdPortalContainerProvider,
} from "@components/ui/overlay-scope";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import {
  findDesktopPage,
  resolveEffectiveWallpaper,
  resolveWorkspaceAppearance,
} from "@veladesk/domain";
import type {
  AppShortcut,
  DesktopPage,
  DesktopPageId,
  EntityId,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import {
  WorkspaceWallpaperLayers,
  useWallpaperAssetUrl,
} from "../desktop-wallpaper";
import { buildAppearanceTheme, resolveEffectiveColorMode } from "../appearance-theme";
import { useSystemPrefersLight } from "../use-system-prefers-light";
import { useDocumentColorScheme } from "../use-document-color-scheme";
import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { launchApp } from "../launch-app";
import { resolveDockEntities } from "../dock-model";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { resolveMobileSectionItems } from "./mobile-section-items";
import { swipePaneSlots } from "./mobile-swipe-model";
import { useSectionSwipe } from "./use-mobile-section-swipe";
import { MobileHeader } from "./mobile-header";
import { MobileCategoryTabs, MOBILE_SECTION_PANEL_ID } from "./mobile-category-tabs";
import { MobileAppGrid } from "./mobile-app-grid";
import { MobileDock } from "./mobile-dock";
import { MobileSearch } from "./mobile-search";
import { MobileFolderSheet } from "./mobile-folder-sheet";
import { MobileMenuSheet } from "./mobile-menu-sheet";
import "./mobile-shell.css";

/**
 * The mobile companion shell (task 026): VelaDesk's CONSUMPTION surface —
 * browse sections, launch apps, open folders, search, use the dock. It
 * shares the workspace runtime, data, wallpaper resolver, icons, search
 * model, i18n and view-state with the desktop, and mounts NONE of the
 * desktop's authoring machinery (no DnD, no resize, no arrange, no
 * management dialogs — §28/§29).
 *
 * Layout (§11): themed root → wallpaper layers → header → category tabs →
 * natively scrolling content (regular derived grid) → pinned dock, with a
 * themed portal sibling for the sheet surfaces. The active section comes
 * from the SHARED owner above the shell switch; every mobile interaction
 * is read-only against the workspace snapshot (§68).
 */
export function MobileShell({
  workspace,
  lastRemoteResult,
  activeSection,
}: {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
  readonly activeSection: WorkspaceActiveSection;
}) {
  const snapshot = workspace.snapshot;
  const reducedMotion = useVdReducedMotion();

  // --- Theme (shared resolver, no mobile preview state — §49) --------------
  const resolvedAppearance = useMemo(
    () => resolveWorkspaceAppearance(snapshot.preferences),
    [snapshot.preferences],
  );
  const theme = useMemo(() => buildAppearanceTheme(resolvedAppearance), [resolvedAppearance]);
  const systemPrefersLight = useSystemPrefersLight();
  const effectiveColorMode = resolveEffectiveColorMode(theme.colorMode, systemPrefersLight);
  useDocumentColorScheme(effectiveColorMode);

  // --- Active section (shared owner; wallpaper follows it — §43/§44) -------
  const activePageId = activeSection.effectiveActivePageId;
  const activePage =
    activePageId === null ? undefined : findDesktopPage(snapshot, activePageId);
  const effectiveWallpaper = useMemo(
    () =>
      resolveEffectiveWallpaper({
        page: activePage,
        pageWallpaperDraft: undefined,
        pageWallpaperExplicitlyInherits: false,
        workspaceWallpaper: resolvedAppearance.wallpaper,
        workspaceDraft: undefined,
        legacyWorkspacePreset: resolvedAppearance.wallpaperPreset,
      }),
    [activePage, resolvedAppearance],
  );
  const wallpaperAssetId =
    effectiveWallpaper.config.kind === "asset" ? effectiveWallpaper.config.assetId : null;
  const loadWallpaperAsset = useCallback(async (assetId: string) => {
    try {
      const runtime = await getBrowserAssetRuntime();
      const result = await runtime.loadAsset(assetId);
      if (result.ok && "blob" in result && result.blob instanceof Blob) {
        return { ok: true, url: URL.createObjectURL(result.blob) };
      }
      return { ok: false, url: null };
    } catch {
      return { ok: false, url: null };
    }
  }, []);
  const wallpaperAssetUrl = useWallpaperAssetUrl(wallpaperAssetId, loadWallpaperAsset);

  // --- The section's consumable items (derived per pane, never persisted) ---
  // No memo: the resolver is a cheap sort+map over one page's items, and the
  // pane list changes identity every switch anyway (§20: stable entity keys).
  const hasDock = useMemo(() => resolveDockEntities(snapshot).length > 0, [snapshot]);

  // --- Consumption surfaces (session state only) ---------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderId, setFolderId] = useState<EntityId | null>(null);

  // Section paging is now a SWIPE STRIP (previous | active | next, moved
  // as one transform). The old two-phase prepared-target coordinator is gone:
  // the neighbours are always mounted, so a swipe reveals content that is
  // already laid out. A tap keeps the short tab-content entrance.
  // The logical active section stays the single source of truth that the
  // tabs, the search sheet and persistence follow.

  const openApp = useCallback((app: AppShortcut) => {
    launchApp(app);
  }, []);

  /** The themed overlay portal root (sibling of the shell root — 018/021-R1). */
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);

  return (
    <VdPortalContainerProvider value={portalRoot}>
    <VdHeroOverlayScope>
    <div
      className="vela-mobile-shell"
      data-vd-ui=""
      data-vd-mobile-shell=""
      data-vd-color-mode={effectiveColorMode}
      data-vd-wallpaper={theme.wallpaperPreset}
      data-has-dock={hasDock ? "true" : "false"}
      style={theme.style as CSSProperties}
    >
      <WorkspaceWallpaperLayers
        wallpaper={effectiveWallpaper}
        assetUrl={wallpaperAssetUrl}
        className="vela-mobile-shell__wallpaper"
      />
      <MobileHeader
        workspace={workspace}
        lastRemoteResult={lastRemoteResult}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
      />
      <MobileCategoryTabs
        pages={snapshot.pages}
        activePageId={activePageId}
        onSelect={activeSection.requestActiveSection}
      />
      <main className="vela-mobile-shell__content" id={MOBILE_SECTION_PANEL_ID} role="tabpanel">
        <SectionSwipeStrip
          pages={snapshot.pages}
          activePageId={activePageId}
          reducedMotion={reducedMotion}
          onCommit={activeSection.requestActiveSection}
          renderPage={(pageId) => (
            <MobileAppGrid
              items={resolveMobileSectionItems({ workspace: snapshot, pageId })}
              workspace={snapshot}
              onOpenApp={openApp}
              onOpenFolder={setFolderId}
            />
          )}
        />
      </main>
      <MobileDock workspace={snapshot} onOpenApp={openApp} onOpenFolder={setFolderId} />

      <MobileSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        workspace={snapshot}
        activePageId={activePageId}
        onOpenApp={openApp}
        onOpenFolder={(id) => {
          setSearchOpen(false);
          setFolderId(id);
        }}
        onSelectSection={(pageId: DesktopPageId) => {
          setSearchOpen(false);
          activeSection.requestActiveSection(pageId);
        }}
      />
      <MobileFolderSheet
        folderId={folderId}
        workspace={snapshot}
        onOpenApp={openApp}
        onFolderClosed={() => setFolderId(null)}
      />
      <MobileMenuSheet open={menuOpen} onOpenChange={setMenuOpen} workspace={workspace} />
    </div>
    <div
      ref={setPortalRoot}
      data-vd-ui=""
      data-vd-portal-root=""
      data-vd-color-mode={effectiveColorMode}
      style={theme.style as CSSProperties}
    />
    </VdHeroOverlayScope>
    </VdPortalContainerProvider>
  );
}

/**
 * The swipe strip (mobile category paging): the active page in flow, the
 * previous/next pages parked one viewport to either side, all translated
 * horizontally as one compositor layer.
 *
 * Why a strip instead of the old two-phase prepared-target machinery: the
 * gesture needs the neighbour to be VISIBLE while the finger moves, so both
 * neighbours stay mounted and laid out. Re-slotting happens only when the
 * active page actually changes, so mid-swipe React re-renders are exactly
 * zero — the finger only touches a transform.
 *
 * The loop is seam-free because the panes are IDENTIFIED BY PAGE ID: when a
 * swipe commits, the pane the user is already looking at simply becomes the
 * centre slot (same DOM node, no remount, no flash).
 * With a single section there are no neighbours and no looping.
 */
function SectionSwipeStrip({
  pages,
  activePageId,
  reducedMotion,
  onCommit,
  renderPage,
}: {
  readonly pages: readonly DesktopPage[];
  readonly activePageId: DesktopPageId | null;
  readonly reducedMotion: boolean;
  readonly onCommit: (pageId: DesktopPageId) => void;
  readonly renderPage: (pageId: DesktopPageId) => React.ReactNode;
}) {
  const pageIds = useMemo(() => pages.map((page) => page.id), [pages]);
  const looping = pageIds.length > 1;
  const { stripRef, onPointerDown } = useSectionSwipe({
    pageIds,
    activePageId,
    onCommit,
    looping,
    reducedMotion,
  });

  const slots = useMemo(
    () => swipePaneSlots({ pageIds, activePageId, looping }),
    [pageIds, activePageId, looping],
  );

  return (
    <div
      ref={stripRef}
      className="vela-mobile-swipe-strip"
      data-swipe-looping={looping ? "true" : "false"}
      onPointerDown={onPointerDown}
    >
      {slots.map(({ pageId, slot, bothSides }) => (
        <div
          key={pageId}
          className="vela-mobile-swipe-slot"
          data-swipe-slot={slot}
          data-swipe-both-sides={bothSides ? "true" : undefined}
          data-section-id={pageId}
          inert={slot === 0 ? undefined : true}
          aria-hidden={slot === 0 ? undefined : "true"}
        >
          {renderPage(pageId)}
        </div>
      ))}
    </div>
  );
}
