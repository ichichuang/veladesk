"use client";

import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import type { DesktopPageId, WorkspaceSnapshot } from "@veladesk/domain";

import { useI18n } from "../../i18n/use-i18n";
import { MobileSheet } from "./mobile-sheet";
import "./mobile-shell.css";

/**
 * The mobile section manager (UX-12): a phone-shaped list of the
 * workspace's sections — 新建分区 on top, then one row per section with
 * reorder / rename / delete. The ACTIONS reuse the desktop's domain edits
 * verbatim (addPage/renamePage through the shared SectionDialog,
 * deleteEmptyPage through the shared confirm); only the surface is new.
 *
 * Rows and every icon button are ≥44px touch targets; deleting the LAST
 * section is impossible (the domain refuses) and lands as the shared
 * dialog's inline error.
 */
export function MobileManageSections({
  workspace,
  onOpenChange,
  onCreate,
  onRename,
  onDelete,
  onMove,
}: {
  readonly workspace: WorkspaceSnapshot;
  readonly onOpenChange: (open: boolean) => void;
  /** New section — opens the shared SectionDialog. */
  readonly onCreate: () => void;
  readonly onRename: (pageId: DesktopPageId) => void;
  readonly onDelete: (pageId: DesktopPageId) => void;
  readonly onMove: (pageId: DesktopPageId, direction: "up" | "down") => void;
}) {
  const { t } = useI18n();
  return (
    <MobileSheet
      open
      onOpenChange={onOpenChange}
      variant="folder"
      label={t("mobile.sections.manage")}
    >
      <div className="vela-mobile-sheet__head">
        <h2 className="vela-mobile-sheet__title">{t("mobile.sections.manage")}</h2>
      </div>
      <div className="vela-mobile-manage__body">
        <button
          type="button"
          className="vela-mobile-manage__create"
          onClick={() => {
            onOpenChange(false);
            onCreate();
          }}
        >
          <Plus size={20} aria-hidden="true" />
          <span>{t("menu.newSection")}</span>
        </button>
        <ul className="vela-mobile-manage__list">
          {workspace.pages.map((page, index) => (
            <li key={page.id} className="vela-mobile-manage__row">
              <span className="vela-mobile-manage__name">
                {page.name}
              </span>
              <span className="vela-mobile-manage__tools">
                <button
                  type="button"
                  className="vela-mobile-icon-button"
                  aria-label={t("menu.moveSectionUp")}
                  disabled={index === 0}
                  onClick={() => onMove(page.id, "up")}
                >
                  <ChevronUp size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="vela-mobile-icon-button"
                  aria-label={t("menu.moveSectionDown")}
                  disabled={index === workspace.pages.length - 1}
                  onClick={() => onMove(page.id, "down")}
                >
                  <ChevronDown size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="vela-mobile-icon-button"
                  aria-label={t("menu.renameSection")}
                  onClick={() => {
                    onOpenChange(false);
                    onRename(page.id);
                  }}
                >
                  <Pencil size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="vela-mobile-icon-button vela-mobile-manage__delete"
                  aria-label={t("menu.deleteSection")}
                  onClick={() => {
                    onOpenChange(false);
                    onDelete(page.id);
                  }}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </MobileSheet>
  );
}
