"use client";

import { useLayoutEffect, useState, type FormEvent } from "react";
import type { WorkspaceCandidate, WorkspaceManagementResult } from "@veladesk/client-runtime";
import type { WorkspaceSnapshot } from "@veladesk/domain";
import { VdFormDialog } from "@components/vd/form-dialog";
import { Input } from "@components/ui/input";
import { useI18n, type TranslateFn } from "../i18n/use-i18n";
import { buildWorkspaceTemplate, type WorkspaceTemplate } from "../import-json/sample-workspace";
import { gsap } from "@components/vd/gsap";
import { vdMotionDuration, VD_MOTION_EASE } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { createBrowserId } from "./browser-id";

export function describeWorkspaceFailure(result: { reason: string; message?: string }, t: TranslateFn): string {
  if (result.message) return result.message;
  switch (result.reason) {
    case "invalid-name": return t("workspace.error.name");
    case "name-conflict": return t("workspace.error.duplicate");
    case "workspace-limit": return t("workspace.limit");
    case "last-workspace": return t("workspace.last");
    case "unsaved-changes": return t("workspace.error.unsaved");
    case "revision-conflict": return t("workspace.error.revision");
    case "busy": return t("workspace.error.busy");
    case "network-error": return t("workspace.error.network");
    default: return t("workspace.error.failed");
  }
}

export function WorkspaceDialog({ candidates, workspace, onCreate, onRename, onClose, open = true, onExitComplete, onFocusReturn }: {
  readonly open?: boolean;
  readonly onFocusReturn?: (() => void) | undefined;
  readonly onExitComplete?: (() => void) | undefined;
  readonly candidates: readonly WorkspaceCandidate[];
  readonly workspace?: WorkspaceCandidate;
  readonly onCreate: (snapshot: WorkspaceSnapshot) => Promise<WorkspaceManagementResult>;
  readonly onRename: (id: string, name: string) => Promise<WorkspaceManagementResult>;
  readonly onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [input, setInput] = useState<string | null>(null);
  let number = 1;
  while (candidates.some(candidate => candidate.name === t("workspace.defaultName", { number }))) number++;
  const name = input ?? workspace?.name ?? t("workspace.defaultName", { number });
  const [templatesHost, setTemplatesHost] = useState<HTMLFieldSetElement | null>(null);
  const reduced = useVdReducedMotion();
  const [template, setTemplate] = useState<WorkspaceTemplate>("blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const elements = Array.from(templatesHost?.querySelectorAll<HTMLElement>(".vela-template-selected") ?? []);
    const tweens = elements.map(element => {
      const selected = element.dataset.template === template;
      if (reduced) { element.style.opacity = selected ? "1" : "0"; return null; }
      return gsap.to(element, { opacity: selected ? 1 : 0, duration: vdMotionDuration("controlState"), ease: VD_MOTION_EASE });
    });
    return () => { tweens.forEach(tween => tween?.kill()); };
  }, [template, reduced, templatesHost]);
  useLayoutEffect(() => {
    const elements = Array.from(templatesHost?.querySelectorAll<HTMLElement>(".vela-template-selected") ?? []);
    return () => elements.forEach(element => { element.style.opacity = ""; });
  }, [templatesHost]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) { setError(t("workspace.error.name")); return; }
    if (candidates.some(candidate => candidate.id !== workspace?.id && candidate.name.trim() === trimmed)) { setError(t("workspace.error.duplicate")); return; }
    setBusy(true); setError(null);
    try {
      const result = workspace === undefined
        ? await onCreate({ ...buildWorkspaceTemplate(template, createBrowserId, locale), name: trimmed })
        : await onRename(workspace.id, trimmed);
      if (result.ok) onClose();
      else setError(describeWorkspaceFailure(result, t));
    } catch { setError(t("workspace.error.failed")); }
    finally { setBusy(false); }
  }
  return <VdFormDialog open={open} onExitComplete={onExitComplete} onFocusReturn={onFocusReturn} title={t(workspace === undefined ? "workspace.createTitle" : "workspace.renameTitle")}
    submitLabel={t(workspace === undefined ? "workspace.createTitle" : "common.save")} busyLabel={t("common.working")} busy={busy} error={error}
    cancelLabel={t("common.cancel")} onCancel={() => { if (!busy) onClose(); }} onSubmit={submit}>
    <label htmlFor="vela-workspace-name" className="text-sm font-medium text-vdu-fg">{t("workspace.name")}</label>
    <Input id="vela-workspace-name" autoFocus autoComplete="off" value={name} disabled={busy} maxLength={40}
      aria-invalid={error !== null} onChange={event => { setInput(event.target.value); setError(null); }} />
    {workspace === undefined ? <fieldset ref={setTemplatesHost} className="vela-workspace-templates" disabled={busy}>
      <legend>{t("workspace.template")}</legend>
      {(["blank", "frontend", "work", "home"] as const).map(value => <label key={value}>
        <span className="vela-template-selected" aria-hidden="true" data-template={value} style={{ opacity: 0 }} />
        <input type="radio" name="workspace-template" value={value} checked={template === value} onChange={() => setTemplate(value)} />
        {t(`workspace.template.${value}`)}
      </label>)}
    </fieldset> : null}
  </VdFormDialog>;
}
