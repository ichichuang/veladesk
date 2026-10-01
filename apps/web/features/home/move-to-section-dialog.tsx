"use client";

import { useState } from "react";
import type { DesktopPageId, EntityId, WorkspaceSnapshot } from "@veladesk/domain";
import { relocateAppToPage } from "@veladesk/domain";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useI18n } from "../i18n/use-i18n";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { Dialog, DialogContent, DialogTitle } from "@components/ui/dialog";
import { VdScrollArea } from "@components/vd/scroll-area";
import { Button } from "@components/ui/button";
import "./home-shell.css";

interface MoveToSectionDialogProps {
  readonly workspace: WorkspaceSnapshot;
  readonly appId: EntityId;
  /** The app's current page, when it lives on one — excluded from the list. */
  readonly currentPageId: DesktopPageId | null;
  readonly onClose: () => void;
}

/**
 * Move-to-Section picker (task 015, 018 designed shell): lists
 * `workspace.pages` minus the app's current page, and relocates the app
 * through the atomic domain operation. A full target section keeps the
 * dialog open with an inline 该分区空间不足 / Not enough room message —
 * the workspace is untouched.
 */
export function MoveToSectionDialog({
  workspace,
  appId,
  currentPageId,
  onClose,
}: MoveToSectionDialogProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = workspace.pages.filter((page) => page.id !== currentPageId);

  async function handleSelect(targetPageId: DesktopPageId) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = relocateAppToPage(workspace, appId, targetPageId);
    if (!result.ok) {
      setError(
        result.reason === "no-space"
          ? t("dialog.moveToSection.error.noSpace")
          : result.reason === "app-not-found"
            ? t("dialog.moveToSection.error.appGone")
            : t("dialog.moveToSection.error.failed")
      );
      setBusy(false);
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setError(t("dialog.moveToSection.error.failed"));
      setBusy(false);
      return;
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[420px] max-w-[calc(100vw-32px)] max-h-[min(560px,calc(100dvh-32px))]"
        data-vd-wheel-scope="local"
      >
        <header className="shrink-0 px-5 pb-2 pt-5">
          <DialogTitle className="text-base">{t("dialog.moveToSection.title")}</DialogTitle>
        </header>
        {/* The one scroll region (VdScrollArea, 021-A); header and footer
            stay fixed. */}
        <VdScrollArea axis="y" className="min-h-0 flex-1 px-5">
          {targets.length === 0 ? (
            <p className="py-4 text-sm text-vdu-fg-muted">{t("dialog.moveToSection.empty")}</p>
          ) : (
            <div
              className="grid gap-1 py-2"
              data-vd-wheel-scope="local"
              role="listbox"
              aria-label={t("dialog.moveToSection.title")}
            >
              {targets.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={[
                    "flex h-10 items-center rounded-vdu border border-vdu-border bg-vdu-bg-raised px-3",
                    "text-left text-sm text-vdu-fg",
                    "hover:border-vdu-border-strong hover:bg-vdu-bg-hover",
                    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vdu-focus)]",
                    "disabled:pointer-events-none disabled:opacity-50",
                  ].join(" ")}
                  disabled={busy}
                  onClick={() => void handleSelect(page.id)}
                >
                  {page.name}
                </button>
              ))}
            </div>
          )}
          {error !== null ? (
            <p className="py-2 text-xs text-vdu-danger" role="alert">
              {error}
            </p>
          ) : null}
        </VdScrollArea>
        <footer className="flex shrink-0 items-center justify-end px-5 pb-5 pt-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
