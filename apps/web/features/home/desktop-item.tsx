"use client";

import { useDraggable } from "@dnd-kit/react";
import type { AppShortcut, WorkspaceEntity, WorkspaceSnapshot } from "@veladesk/domain";
import type { LayoutItem } from "@veladesk/desktop-engine";

import { generatedIconText } from "./generated-icon";
import { launchApp } from "./launch-app";
import "./home-shell.css";

interface DesktopItemProps {
  readonly item: LayoutItem;
  readonly workspace: WorkspaceSnapshot;
  /** Arrange mode allows dragging; view mode launches apps on activation. */
  readonly arrange: boolean;
  readonly metricsAvailable: boolean;
}

/**
 * One desktop entity (app, folder or widget) placed on the page grid.
 *
 * Apps are buttons: native focus and Enter/Space keep launch accessible in
 * view mode, while dnd-kit's keyboard sensor owns drag gestures in arrange
 * mode. Folders are focus-only in this stage. Widgets are the only entities
 * rendered as a surface/card. A missing entity renders a restrained
 * placeholder instead of crashing the desktop.
 */
export function DesktopItem({ item, workspace, arrange, metricsAvailable }: DesktopItemProps) {
  const entity = workspace.entities.find((candidate) => candidate.id === item.id);
  if (entity === undefined) {
    return (
      <div
        className="vela-item vela-item--missing"
        style={placementStyle(item)}
        title="This item references a missing entity"
      >
        <span className="vela-item__label">Missing item</span>
      </div>
    );
  }
  return (
    <DesktopEntity
      item={item}
      entity={entity}
      arrange={arrange}
      metricsAvailable={metricsAvailable}
    />
  );
}

interface DesktopEntityProps {
  readonly item: LayoutItem;
  readonly entity: WorkspaceEntity;
  readonly arrange: boolean;
  readonly metricsAvailable: boolean;
}

function DesktopEntity({ item, entity, arrange, metricsAvailable }: DesktopEntityProps) {
  const { ref, isDragging } = useDraggable({
    id: item.id,
    disabled: !arrange || !metricsAvailable,
  });

  const commonStyle = { ...placementStyle(item), ...(isDragging ? { zIndex: 30 } : {}) };
  const draggingProps = { "data-dragging": isDragging ? "true" : undefined } as const;

  if (entity.kind === "app") {
    return (
      <button
        type="button"
        ref={ref}
        className="vela-item"
        data-kind="app"
        {...draggingProps}
        style={commonStyle}
        title={entity.name}
        onClick={() => {
          // Arrange mode reserves clicks for focus/drag; only view launches.
          if (arrange) {
            return;
          }
          launchApp(entity);
        }}
      >
        <span className="vela-item__icon" aria-hidden="true">
          {appIconText(entity)}
        </span>
        <span className="vela-item__label">{entity.name}</span>
      </button>
    );
  }

  if (entity.kind === "folder") {
    return (
      <button
        type="button"
        ref={ref}
        className="vela-item"
        data-kind="folder"
        {...draggingProps}
        style={commonStyle}
        title={`${entity.name} — folders open in a later update`}
        onClick={() => {
          // Deliberate no-op: selecting/focusing is the entire v1 contract.
        }}
      >
        <span className="vela-item__icon vela-item__icon--folder" aria-hidden="true">
          <FolderGlyph />
        </span>
        <span className="vela-item__label">{entity.name}</span>
      </button>
    );
  }

  return (
    <div
      ref={ref}
      className="vela-item vela-item--widget"
      data-kind="widget"
      {...draggingProps}
      style={commonStyle}
      tabIndex={0}
    >
      <span className="vela-item__widget-title">{entity.title ?? entity.widgetType}</span>
    </div>
  );
}

function placementStyle(item: LayoutItem): React.CSSProperties {
  return {
    gridColumn: `${item.position.column + 1} / span ${item.span.columns}`,
    gridRow: `${item.position.row + 1} / span ${item.span.rows}`,
  };
}

function appIconText(app: AppShortcut): string {
  // Favicon/iconify/asset icons intentionally render the generated fallback
  // in v1 — no icon fetching or runtimes in this task.
  if (app.icon.kind === "generated") {
    return app.icon.text.trim().length > 0 ? app.icon.text : generatedIconText(app.name);
  }
  return generatedIconText(app.name);
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" role="presentation" focusable="false">
      <path
        d="M4 9.5C4 8.1 5.1 7 6.5 7h6l3 3h10c1.4 0 2.5 1.1 2.5 2.5v11c0 1.4-1.1 2.5-2.5 2.5h-19C5.1 26 4 24.9 4 23.5v-14Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M4 13h24v1.5H4z"
        fill="var(--vd-bg)"
        opacity="0.35"
      />
    </svg>
  );
}
