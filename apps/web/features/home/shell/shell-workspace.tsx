"use client";

import type { RefObject } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type {
  DesktopPage,
  DesktopPageId,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { canRedo, canUndo } from "../../canvas/arrange-history";
import { ArrangeToolbar } from "../arrange-toolbar";
import { SectionSyncStatus } from "../section-sync-status";
import { SceneViewport } from "../scene/scene-viewport";
import type { DesktopScene } from "../scene/use-desktop-scene";
import { TileHostLayer } from "../tile-host/tile-host-layer";
import type { TileSession } from "../tile-host/use-tile-session";

export interface ShellWorkspaceProps {
  readonly arrange: boolean;
  readonly activePage: DesktopPage | undefined;
  readonly effectiveActivePageId: DesktopPageId | null;
  readonly renderedSnapshot: WorkspaceSnapshot;
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
  /** The effective grid gap (session preview ?? persisted). */
  readonly displayGapPx: number;
  readonly scrollLocked: boolean;
  readonly appearanceEditingId: EntityId | null;
  /** Latest-value mirror of the effective active page id. */
  readonly pageIdRef: RefObject<DesktopPageId | null>;
  /** The section viewport element (scene-owned box, shell-owned ref). */
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  readonly scene: DesktopScene;
  readonly tiles: TileSession;
  readonly onGridGapChange: (gapPx: number) => void;
  readonly onAreaContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
}

/**
 * The shell's right workspace column (P1-ENG-1): the arrange toolbar, the
 * scene viewport with its mounted warm layers, and the sync status — the
 * contiguous block inside `vela-workspace` in the former desktop-shell
 * render, extracted VERBATIM. The toolbar's history availability is
 * computed here (imperative history map, freshest value), exactly where it
 * used to be computed one line above the old render.
 */
export function ShellWorkspace({
  arrange,
  activePage,
  effectiveActivePageId,
  renderedSnapshot,
  workspace,
  lastRemoteResult,
  displayGapPx,
  scrollLocked,
  appearanceEditingId,
  pageIdRef,
  viewportRef,
  scene,
  tiles,
  onGridGapChange,
  onAreaContextMenu,
  onEntityContextMenu,
  onOpenFolder,
}: ShellWorkspaceProps) {
  // Arrange-toolbar availability (imperative history map, freshest value).
  const toolbarHistoryUsable =
    effectiveActivePageId !== null && !tiles.draggingRef.current && tiles.commits.pendingHandoffRef.current === null;
  const toolbarCanUndo =
    toolbarHistoryUsable &&
    effectiveActivePageId !== null &&
    canUndo(tiles.commits.arrangeHistoriesRef.current, effectiveActivePageId);
  const toolbarCanRedo =
    toolbarHistoryUsable &&
    effectiveActivePageId !== null &&
    canRedo(tiles.commits.arrangeHistoriesRef.current, effectiveActivePageId);

  return (
    <div className="vela-workspace">
      {arrange && activePage !== undefined ? (
        <ArrangeToolbar
          placementMode={tiles.commits.displayPlacement?.mode ?? "grid"}
          freeformBlockedReason={tiles.commits.freeformBlockedReason}
          onSetPlacementMode={tiles.commits.setPlacementMode}
          gridGapPx={displayGapPx}
          onGridGapChange={onGridGapChange}
          canUndo={toolbarCanUndo}
          canRedo={toolbarCanRedo}
          onUndo={() => {
            if (pageIdRef.current !== null) {
              tiles.commits.applyHistoryStep(pageIdRef.current, "undo");
            }
          }}
          onRedo={() => {
            if (pageIdRef.current !== null) {
              tiles.commits.applyHistoryStep(pageIdRef.current, "redo");
            }
          }}
        />
      ) : null}

      {/*
        The one section viewport (018, warm-layered in 020-A2): every
        MOUNTED section renders as a stable layer keyed by its page
        id — the active ±1 warm set. Only the active (and, during a
        transition, its exiting partner) is visible; hidden warm
        layers keep real geometry for measurement but never paint,
        take pointers or duplicate accessibility. A switch starts the
        pose-driven transition on EXISTING subtrees — the destination
        is never built inside the transition commit. While a modal or
        a drag is up, data-scroll-locked freezes the active scroller
        without changing scrollTop.
      */}
      <SceneViewport
        sectionNavMachine={scene.machine}
        viewportRef={viewportRef}
        onContextMenu={onAreaContextMenu}
      >
        {scene.mountedSectionLayers.map((page) => (
          <TileHostLayer
            key={page.id}
            page={page}
            machine={scene.machine}
            activePageId={effectiveActivePageId}
            onLayerElement={scene.registerSectionLayer}
            displayPlacement={page.id === effectiveActivePageId ? tiles.commits.displayPlacement : null}
            renderedWorkspace={renderedSnapshot}
            arrange={arrange}
            dragEnabled={arrange && !tiles.commits.handoffLock && !tiles.commits.resizeLock}
            scrollLocked={scrollLocked}
            appearanceEditingId={appearanceEditingId}
            metrics={tiles.freeformMetrics}
            gridMetrics={tiles.gridMetrics}
            canvasRef={tiles.canvasRef}
            gridStageRef={tiles.gridStageRef}
            selectedIds={tiles.selectedItemIds}
            resizableIds={tiles.resizableIds}
            resizeActiveId={tiles.commits.resizeActiveId}
            gridFeedbackBoxes={tiles.gridFeedbackBoxes}
            initialScrollTop={scene.sectionScrollMemory().recall(page.id)}
            onResizeCommit={tiles.commits.commitResizedGeometry}
            onResizeSessionChange={tiles.commits.handleResizeSessionChange}
            onResizePreview={tiles.setResizeTargetBox}
            onItemSelect={tiles.handleItemSelect}
            onEntityContextMenu={onEntityContextMenu}
            onOpenFolder={onOpenFolder}
            onCanvasPointerDown={tiles.handleViewportPointerDown}
            onCanvasPointerMove={tiles.handleViewportPointerMove}
            onCanvasPointerUp={tiles.handleViewportPointerUp}
          />
        ))}
      </SceneViewport>

      {/*
        Sync state is a quiet GLOBAL status, not part of the section
        list: it renders only when there is something to say.
      */}
      <SectionSyncStatus workspace={workspace} lastRemoteResult={lastRemoteResult} />
    </div>
  );
}
