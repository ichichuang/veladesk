"use client";

import { ArrowLeftRight, Pencil, Trash2 } from "lucide-react";

import { useI18n } from "../../i18n/use-i18n";
import { MobileSheet } from "./mobile-sheet";
import "./mobile-shell.css";

/**
 * The mobile tile action menu (UX-12): the bottom sheet a 450ms hold on an
 * app tile opens — 编辑 / 移到分区 / 删除. It is a MENU only: every row
 * closes the sheet and routes to the shared surface the DESKTOP already
 * uses (the edit dialog with the UX-04 URL gate, the move picker, the
 * delete confirm + UX-09 undo toast), so the two shells can never drift
 * apart on editing semantics.
 *
 * Rows are ≥52px touch targets; destructive delete sits apart on the
 * danger token. Esc / scrim tap / the close button all dismiss (Radix
 * semantics through MobileSheet).
 */
export function MobileTileMenu({
  appName,
  onOpenChange,
  onEdit,
  onMoveToSection,
  onDelete,
}: {
  /** The held app's name (the sheet's title context). */
  readonly appName: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onEdit: () => void;
  readonly onMoveToSection: () => void;
  readonly onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <MobileSheet
      open
      onOpenChange={onOpenChange}
      variant="menu"
      label={t("mobile.tileMenu.label", { name: appName })}
    >
      <div className="vela-mobile-sheet__head">
        <h2 className="vela-mobile-sheet__title">{appName}</h2>
      </div>
      <div className="vela-mobile-action-menu" role="menu" aria-label={appName}>
        <button
          type="button"
          role="menuitem"
          className="vela-mobile-action-menu__row"
          onClick={() => {
            onOpenChange(false);
            onEdit();
          }}
        >
          <Pencil size={20} aria-hidden="true" />
          <span>{t("menu.edit")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="vela-mobile-action-menu__row"
          onClick={() => {
            onOpenChange(false);
            onMoveToSection();
          }}
        >
          <ArrowLeftRight size={20} aria-hidden="true" />
          <span>{t("menu.moveToSection")}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="vela-mobile-action-menu__row vela-mobile-action-menu__row--danger"
          onClick={() => {
            onOpenChange(false);
            onDelete();
          }}
        >
          <Trash2 size={20} aria-hidden="true" />
          <span>{t("menu.delete")}</span>
        </button>
      </div>
    </MobileSheet>
  );
}
