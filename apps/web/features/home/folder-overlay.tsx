"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { AppShortcut, EntityId, Folder, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";

import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { useI18n } from "../i18n/use-i18n";
import { launchApp } from "./launch-app";
import { useLaunchFeedback } from "./launch-feedback";
import { VdScrollArea } from "@components/vd/scroll-area";
import { useVdPresence } from "@components/vd/presence";
import { VdAnimatedSurface } from "@components/vd/animated-surface";
import { AppIconTile } from "./app-icon-renderer";
import { useRetainedRows } from "./retained-list";
import {
  appLabelPresentation,
  appVisual,
  buildAppIconStyleVars,
} from "./app-icon";
import {
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import "./home-shell.css";

interface FolderOverlayProps {
  /** Requested visibility; the overlay stays mounted through its exit. */
  readonly open: boolean;
  readonly folder: Folder;
  readonly workspace: WorkspaceSnapshot;
  /** Presentation-only action error (e.g. no-space on dissolve). */
  readonly error?: string | undefined;
  readonly onClose: () => void;
  readonly onChildContextMenu: (entityId: EntityId, x: number, y: number) => void;
}

/**
 * Spatial glass overlay for a legacy folder (task 015).
 *
 * Folders are compatibility-only in the primary UI now: children render in
 * `folder.children` order (launch on click), the overlay scrolls locally,
 * and there is NO "Add App" entry anymore — apps move into sections via
 * their context menu. Escape or a backdrop click closes.
 */
export function FolderOverlay({
  open,
  folder,
  workspace,
  error,
  onClose,
  onChildContextMenu,
}: FolderOverlayProps) {
  const { t } = useI18n();
  const notifyLaunch = useLaunchFeedback();
  // Presence (022): a close intent plays the exit while the semantics
  // stand down; only the exit completion releases the subtree.
  const presence = useVdPresence(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  function childContextMenu(event: ReactMouseEvent, entityId: EntityId) {
    event.preventDefault();
    event.stopPropagation();
    onChildContextMenu(entityId, event.clientX, event.clientY);
  }

  function launchChild(app: AppShortcut) {
    // UX-04: a legacy unparseable URL toasts instead of opening an error
    // page (same channel as the desktop tiles).
    if (!launchApp(app)) {
      notifyLaunch(t("toast.appUnlaunchable", { name: app.name }));
    }
  }

  function childKeyDown(event: ReactKeyboardEvent<HTMLElement>, entityId: EntityId) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    onChildContextMenu(entityId, anchor.x, anchor.y);
  }

  const children = useMemo(
    () =>
      folder.children.map((childId) => ({
        childId,
        entity: workspace.entities.find((candidate) => candidate.id === childId),
      })),
    [folder.children, workspace.entities],
  );
  // Audit A12: a child moved out of the folder (or deleted) keeps its grid
  // cell for the exit fade — same retained-list treatment as the dock, but
  // with NO wrapper node: the existing .vela-item button/div renders
  // directly from OverlayGridItem, so the container-query and label
  // contracts that key off grid children stay untouched.
  const rows = useRetainedRows(children, (child) => child.childId);

  if (!presence.mounted) {
    return null;
  }

  return (
    <VdAnimatedSurface
      variant="overlay"
      active={open}
      onPresenceReleased={presence.completeExit}
      className="vela-folder-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={folder.name}
      inert={open ? undefined : true}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <VdAnimatedSurface
        variant="launcher"
        active={open}
        onPresenceReleased={presence.completeExit}
        className="vela-folder-overlay__panel"
      >
        <section className="vela-folder-overlay__panel-inner">
        <header className="vela-folder-overlay__header">
          <h2 className="vela-folder-overlay__title">{folder.name}</h2>
          <span className="vela-folder-overlay__spacer" />
          <button
            type="button"
            className="vela-button vela-folder-overlay__close"
            aria-label={t("overlay.close")}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        {error !== undefined && error.length > 0 ? (
          <p className="vela-folder-overlay__error" role="alert">
            {error}
          </p>
        ) : null}
        {/* The scroll owner (VdScrollArea, 021-A) — the grid inside is
            layout only. Wheel stays local to the overlay. */}
        <VdScrollArea axis="y" smooth className="vela-folder-overlay__scroll" data-vd-wheel-scope="local">
          <div className="vela-folder-overlay__grid">
          {rows.map((row) => (
            <OverlayGridItem
              key={row.key}
              exiting={row.exiting}
              release={row.release}
              childId={row.item.childId}
              entity={row.item.entity}
              onLaunch={launchChild}
              onChildContextMenu={childContextMenu}
              onChildKeyDown={childKeyDown}
            />
          ))}
          {rows.length === 0 ? (
            <p className="vela-folder-overlay__empty">{t("overlay.empty")}</p>
          ) : null}
          </div>
        </VdScrollArea>
        <p className="vela-folder-overlay__hint">{t("overlay.dissolveHint")}</p>
        </section>
      </VdAnimatedSurface>
    </VdAnimatedSurface>
  );
}

/**
 * One folder-overlay grid item (audit A12): renders the SAME `.vela-item`
 * button/div the grid has always had — NO wrapper node, so every
 * grid-child contract (container queries, cqmin label sizing, appearance
 * data attributes) keeps resolving against the direct child. A REMOVED
 * child stays mounted through one opacity fade (GSAP on the item node
 * itself; reduced motion releases instantly) and goes pointer/keyboard
 * inert while it leaves, exactly like the workspace menu's exiting rows.
 */
function OverlayGridItem({
  exiting,
  release,
  childId,
  entity,
  onLaunch,
  onChildContextMenu,
  onChildKeyDown,
}: {
  readonly exiting: boolean;
  readonly release: () => void;
  readonly childId: EntityId;
  readonly entity: WorkspaceEntity | undefined;
  readonly onLaunch: (app: AppShortcut) => void;
  readonly onChildContextMenu: (event: ReactMouseEvent, entityId: EntityId) => void;
  readonly onChildKeyDown: (event: ReactKeyboardEvent<HTMLElement>, entityId: EntityId) => void;
}) {
  const { t } = useI18n();
  const node = useRef<HTMLElement | null>(null);
  const releaseRef = useRef(release);
  const reduced = useVdReducedMotion();
  useLayoutEffect(() => {
    releaseRef.current = release;
  });
  useLayoutEffect(() => {
    const element = node.current;
    if (element === null || !exiting) {
      return;
    }
    if (reduced) {
      releaseRef.current();
      return;
    }
    gsap.killTweensOf(element);
    const tween = gsap.to(element, {
      opacity: 0,
      duration: vdMotionDuration("hoverPress"),
      ease: VD_MOTION_EASE,
      onComplete: () => releaseRef.current(),
    });
    return () => {
      tween.kill();
      gsap.set(element, { clearProps: "opacity" });
    };
  }, [exiting, reduced]);
  const capture = (element: HTMLElement | null) => {
    node.current = element;
  };
  const inert = exiting || undefined;

  if (entity === undefined) {
    return (
      <div
        ref={capture}
        className="vela-item vela-item--missing"
        title={t("overlay.missingApp")}
        inert={inert}
        aria-hidden={exiting || undefined}
      >
        <span className="vela-item__label">{t("overlay.missingApp")}</span>
      </div>
    );
  }
  if (entity.kind !== "app") {
    // V1 folders contain apps only — render defensively.
    return (
      <div
        ref={capture}
        className="vela-item vela-item--missing"
        title={t("overlay.unsupported")}
        inert={inert}
        aria-hidden={exiting || undefined}
      >
        <span className="vela-item__label">{t("overlay.unsupported")}</span>
      </div>
    );
  }
  return (
    <button
      ref={capture}
      type="button"
      className="vela-item"
      data-kind="app"
      data-appearance-app-id={entity.id}
      style={buildAppIconStyleVars(appVisual(entity)) as CSSProperties}
      // Same presentation contract as the desktop (017-C): the
      // overlay renders the app's icon-scale label settings, and
      // the accessible name survives a hidden visible label.
      aria-label={entity.name}
      title={entity.name}
      inert={inert}
      onClick={() => onLaunch(entity)}
      onContextMenu={(event) => onChildContextMenu(event, childId)}
      onKeyDown={(event) => onChildKeyDown(event, childId)}
    >
      <AppIconTile app={entity} />
      {appLabelPresentation(appVisual(entity)).visible ? (
        <span className="vela-item__label">{entity.name}</span>
      ) : null}
    </button>
  );
}
