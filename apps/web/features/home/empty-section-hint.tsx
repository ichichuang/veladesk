"use client";

import type { DesktopPageId } from "@veladesk/domain";

import { useI18n } from "../i18n/use-i18n";
import { useEngineeringMode } from "../engineering/engineering-mode-context";
import { useShellContext } from "./shell/shell-context";
import "./home-shell.css";

/**
 * The empty-section guidance tile (UX-08, visual designer's brief): when a
 * section has no apps, ONE 2×1 dashed placeholder tile carries the
 * next-step copy and the primary 「添加应用」 action — the SAME add-app
 * dialog the rest of the desktop uses, targeted at THIS section. The
 * ground is a faint nautical-chart grid (token-derived, no illustration).
 *
 * The entrance is a component-owned CSS fade on the popover motion token
 * (not a GSAP tween): the tile mounts inside warm section layers too, and
 * idle entrance tweens on the shared GSAP ticker would steal frames from
 * live section transitions. The global reduced-motion rule collapses the
 * animation to an instant appearance.
 *
 * Rendered inside the section's own placement host (grid cell span or
 * freeform canvas), so it never intercepts the context menu or the
 * arrange-mode lattice — it is content, not chrome. The shell context
 * supplies the dialog dispatch (the sanctioned shell-authority channel),
 * so no new prop threads through the memoized layer stack.
 */
export function EmptySectionHint({
  pageId,
  variant,
}: {
  /** The empty section the add-app dialog targets. */
  readonly pageId: DesktopPageId;
  /** Grid = a real 2×1 cell tile; freeform = an anchored canvas box. */
  readonly variant: "grid" | "freeform";
}) {
  const { t } = useI18n();
  const { engineering } = useEngineeringMode();
  const { dispatch } = useShellContext();

  // t181 Use mode: the hint (and its 「添加应用」 action) is an editing
  // affordance — it does not render at all. The section is empty by
  // definition, so its absence cannot shift any other element.
  if (!engineering) {
    return null;
  }

  return (
    <div
      className="vela-empty-section"
      data-empty-section=""
      data-variant={variant}
    >
      <p className="vela-empty-section__text">{t("emptySection.text")}</p>
      <button
        type="button"
        className="vela-button vela-button--primary vela-empty-section__action"
        onClick={() =>
          dispatch({ kind: "open-dialog", dialog: { kind: "add-app", pageId } })
        }
      >
        {t("emptySection.addApp")}
      </button>
    </div>
  );
}
