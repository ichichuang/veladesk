"use client";

import type { PagePlacementMode } from "@veladesk/canvas-engine";
import {
  GRID_GAP_STEP_PX,
  MAX_GRID_GAP_PX,
  MIN_GRID_GAP_PX,
} from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import "./home-shell.css";

interface ArrangeToolbarProps {
  /** Placement mode of the ACTIVE section (resolved, v2). */
  readonly placementMode: PagePlacementMode;
  /** Why the Freeform switch is refused (lossy conversion), if it is. */
  readonly freeformBlockedReason: string | null;
  /** Switch the active section's placement mode. */
  readonly onSetPlacementMode: (mode: PagePlacementMode) => void;
  /** The effective grid gap (preview override included). */
  readonly gridGapPx: number;
  /** Persist one completed gap change. */
  readonly onGridGapChange: (gapPx: number) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

/**
 * The compact Arrange-only control surface of the right workspace
 * (task 017): Grid/Freeform mode switch, the Grid gap stepper and
 * undo/redo.
 *
 * It is small and visually quiet, sits in the workspace's reserved top
 * band so it never covers application content, and never renders in View
 * mode. Each gap step is one completed change — one durable write, never a
 * write per pointer event.
 */
export function ArrangeToolbar({
  placementMode,
  freeformBlockedReason,
  onSetPlacementMode,
  gridGapPx,
  onGridGapChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ArrangeToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="vela-arrange-bar" role="toolbar" aria-label={t("arrange.toolbarLabel")}>
      <div
        className="vela-arrange-bar__modes"
        role="group"
        aria-label={t("arrange.modeLabel")}
      >
        <button
          type="button"
          className="vela-segmented__option"
          aria-pressed={placementMode === "grid"}
          onClick={() => onSetPlacementMode("grid")}
        >
          {t("arrange.modeGrid")}
        </button>
        <button
          type="button"
          className="vela-segmented__option"
          aria-pressed={placementMode === "freeform"}
          disabled={freeformBlockedReason !== null && placementMode !== "freeform"}
          title={freeformBlockedReason ?? undefined}
          onClick={() => onSetPlacementMode("freeform")}
        >
          {t("arrange.modeFreeform")}
        </button>
      </div>

      {placementMode === "grid" ? (
        <div className="vela-arrange-bar__gap" role="group" aria-label={t("arrange.gridGapLabel")}>
          <span className="vela-arrange-bar__gap-label">{t("arrange.gridGapLabel")}</span>
          <button
            type="button"
            className="vela-arrange-bar__gap-step"
            aria-label={t("arrange.decreaseGap")}
            disabled={gridGapPx <= MIN_GRID_GAP_PX}
            onClick={() => onGridGapChange(Math.max(MIN_GRID_GAP_PX, gridGapPx - GRID_GAP_STEP_PX))}
          >
            −
          </button>
          <output className="vela-arrange-bar__gap-value">{gridGapPx}px</output>
          <button
            type="button"
            className="vela-arrange-bar__gap-step"
            aria-label={t("arrange.increaseGap")}
            disabled={gridGapPx >= MAX_GRID_GAP_PX}
            onClick={() => onGridGapChange(Math.min(MAX_GRID_GAP_PX, gridGapPx + GRID_GAP_STEP_PX))}
          >
            +
          </button>
        </div>
      ) : null}

      <span className="vela-arrange-bar__spacer" />

      <button
        type="button"
        className="vela-arrange-bar__history"
        aria-label={t("menu.undoArrange")}
        disabled={!canUndo}
        onClick={onUndo}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M8.5 4.5 4 9l4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 9h7.2a4.3 4.3 0 1 1 0 8.6H8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="vela-arrange-bar__history"
        aria-label={t("menu.redoArrange")}
        disabled={!canRedo}
        onClick={onRedo}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M11.5 4.5 16 9l-4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16 9H8.8a4.3 4.3 0 1 0 0 8.6H12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
