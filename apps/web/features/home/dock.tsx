"use client";

import type { WorkspaceSnapshot } from "@veladesk/domain";

import { generatedIconText } from "./generated-icon";
import { launchApp } from "./launch-app";
import "./home-shell.css";

interface DockProps {
  readonly workspace: WorkspaceSnapshot;
  /** Arrange mode relabels the mode utility; drag sessions lock it. */
  readonly arrange: boolean;
  readonly dragging: boolean;
  readonly onToggleMode: () => void;
  readonly onAddApp: () => void;
}

/**
 * Floating bottom dock: the workspace's pinned items in stored order, then
 * the utility cluster. Dock apps launch on click in both modes; folders are
 * focus-only; pinning/reordering arrives in a later task.
 */
export function Dock({ workspace, arrange, dragging, onToggleMode, onAddApp }: DockProps) {
  const dockEntities = workspace.dock.items
    .map((entityId) => workspace.entities.find((entity) => entity.id === entityId))
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined)
    .filter((entity) => entity.kind !== "widget");

  return (
    <nav className="vela-dock" aria-label="Dock">
      {dockEntities.map((entity) =>
        entity.kind === "app" ? (
          <button
            key={entity.id}
            type="button"
            className="vela-dock__item"
            title={entity.name}
            aria-label={`Open ${entity.name}`}
            onClick={() => launchApp(entity)}
          >
            {generatedIconText(entity.name)}
          </button>
        ) : (
          <button
            key={entity.id}
            type="button"
            className="vela-dock__item vela-dock__item--folder"
            title={`${entity.name} — folders open in a later update`}
            aria-label={entity.name}
            onClick={() => {
              // Focus-only in v1.
            }}
          >
            {generatedIconText(entity.name)}
          </button>
        )
      )}

      <span className="vela-dock__separator" aria-hidden="true" />
      <button
        type="button"
        className="vela-dock__utility"
        title="Add app"
        aria-label="Add app"
        disabled={dragging}
        onClick={onAddApp}
      >
        +
      </button>
      <button
        type="button"
        className="vela-dock__utility vela-dock__utility--text"
        title={arrange ? "Switch to view mode" : "Switch to arrange mode"}
        aria-pressed={arrange}
        disabled={dragging}
        onClick={onToggleMode}
      >
        {arrange ? "View" : "Arrange"}
      </button>
    </nav>
  );
}
