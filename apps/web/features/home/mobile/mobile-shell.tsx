"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  VdHeroOverlayScope,
  VdPortalContainerProvider,
} from "@components/ui/overlay-scope";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import {
  findDesktopPage,
  resolveEffectiveWallpaper,
  resolveWorkspaceAppearance,
} from "@veladesk/domain";
import type {
  AppShortcut,
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
import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { launchApp } from "../launch-app";
import { resolveDockEntities } from "../dock-model";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { resolveMobileSectionItems } from "./mobile-section-items";
import {
  pendingMobilePageId,
  useMobileSectionTransition,
  visibleMobilePageId,
} from "./mobile-section-transition";
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

  // The prepared-target coordinator (R2 §7): the LOGICAL destination is
  // activePageId above (tabs/persistence react immediately); the VISUAL
  // panes follow the machine — target hidden-mounted first, armed one
  // frame after its layout pass, entrance on a settled tree.
  const { machine: transition, settle: settleTransition } = useMobileSectionTransition(
    activePageId,
    { reducedMotion },
  );
  const visibleId = visibleMobilePageId(transition);
  const pendingId = pendingMobilePageId(transition);
  const panePageIds = snapshot.pages
    .map((page) => page.id)
    .filter((pageId) => pageId === visibleId || pageId === pendingId);

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
        {/* §18/R2 §7: prepared-target panes in stable page order — at most
            the visible page plus ONE hidden-mounted pending page. The
            heavy grid mount happens in the preparing commit (which paints
            no new content); the entrance runs on the next frame's settled
            tree. Reduced motion bypasses straight to the settled swap. */}
        {panePageIds.map((panePageId) => (
          <MobileSectionPane
            key={panePageId}
            pageId={panePageId}
            mode={
              panePageId === pendingId
                ? "pending"
                : transition.phase === "entering" && panePageId === transition.targetId
                  ? "entering"
                  : "visible"
            }
            reducedMotion={reducedMotion}
            onSettled={settleTransition}
          >
            <MobileAppGrid
              items={resolveMobileSectionItems({ workspace: snapshot, pageId: panePageId })}
              workspace={snapshot}
              onOpenApp={openApp}
              onOpenFolder={setFolderId}
            />
          </MobileSectionPane>
        ))}
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
 * One section pane (R2 §7/§23): the transform/opacity wrapper the entrance
 * owns. Modes: "pending" (hidden-mounted preparation — visibility/inert via
 * CSS + attributes, never display:none), "entering" (the ONE short settle:
 * x 12px + fade on the tab-content band), "visible" (the resting pane; the
 * boot page mounts straight here — a restored section never plays an
 * entrance sweep). Re-renders never restart a running tween (effect deps
 * are mode-level); a mid-flight entrance that gets superseded snaps its
 * page to the settled pose so the base stays fully opaque. Reduced motion
 * settles instantly (§33/§61).
 */
function MobileSectionPane({
  pageId,
  mode,
  reducedMotion,
  onSettled,
  children,
}: {
  readonly pageId: DesktopPageId | null;
  readonly mode: "pending" | "entering" | "visible";
  readonly reducedMotion: boolean;
  readonly onSettled: () => void;
  readonly children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onSettledRef = useRef(onSettled);
  useLayoutEffect(() => {
    onSettledRef.current = onSettled;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || mode !== "entering") {
      return;
    }
    if (reducedMotion) {
      gsap.set(element, { x: 0, opacity: 1 });
      onSettledRef.current();
      return;
    }
    const tween = gsap.fromTo(
      element,
      { x: 12, opacity: 0 },
      {
        x: 0,
        opacity: 1,
        duration: vdMotionDuration("tabContent"),
        ease: VD_MOTION_EASE,
        clearProps: "transform",
        onComplete: () => {
          onSettledRef.current();
        },
      },
    );
    return () => {
      // Retarget mid-flight: the tween dies and this page — now the visible
      // base for the next preparation — snaps to the settled pose.
      tween.kill();
      gsap.set(element, { x: 0, opacity: 1 });
    };
  }, [mode, reducedMotion]);
  return (
    <div
      ref={ref}
      className={`vela-mobile-pane vela-mobile-pane--${mode}`}
      data-section-id={pageId ?? ""}
      inert={mode === "pending" ? true : undefined}
      aria-hidden={mode === "pending" ? "true" : undefined}
    >
      {children}
    </div>
  );
}
