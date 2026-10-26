"use client";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { gsap } from "@components/vd/gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "@components/vd/motion-tokens";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import type { DesktopMenuEntry } from "./desktop-command-menu";
import { useI18n } from "../i18n/use-i18n";
import { clearMotion } from "./workspace-motion";

type Action = Extract<DesktopMenuEntry, { kind: "action" }>;
/** Retain vanished rows only for their exit; keys and keyboard order otherwise stay stable. */
export function MotionMenuEntries({ entries, renderEntry }: { readonly entries: readonly DesktopMenuEntry[]; readonly renderEntry: (entry: DesktopMenuEntry, index: number, exiting: boolean, release: () => void) => ReactNode }) {
  const [previous, setPrevious] = useState(entries);
  const [retained, setRetained] = useState<readonly { entry: DesktopMenuEntry; index: number }[]>([]);
  if (previous !== entries) {
    setPrevious(entries);
    const exists = (entry: DesktopMenuEntry) => entry.kind !== "action" || entries.some(next => next.kind === "action" && next.id === entry.id);
    const kept = retained.filter(({ entry }) => !exists(entry));
    const removed = previous.map((entry, index) => ({ entry, index })).filter(({ entry }) => !exists(entry) && !kept.some(item => item.entry === entry));
    setRetained([...kept, ...removed].sort((a, b) => a.index - b.index));
  }
  const displayed = [...entries];
  retained.forEach(({ entry, index }) => displayed.splice(index, 0, entry));
  return <>{displayed.map((entry, index) => renderEntry(entry, index, retained.some(item => item.entry === entry), () => setRetained(current => current.filter(item => item.entry !== entry))))}</>;
}

export function WorkspaceMenuRow({ entry, exiting, release, onSelect, onTool, mobile = false }: {
  readonly entry: Action; readonly exiting: boolean; readonly release: () => void;
  readonly onSelect: () => void; readonly onTool: (action: () => void) => void; readonly mobile?: boolean;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const check = useRef<HTMLSpanElement>(null);
  const flash = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const tools = useRef<HTMLSpanElement>(null);
  const hintId = useId();
  const showHint = entry.disabled === true && entry.reason !== undefined && entry.tools === undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.label);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shownCheck = useRef(false);
  const oldLabel = useRef(entry.label);
  const reduced = useVdReducedMotion();
  const releaseRef = useRef(release);
  useLayoutEffect(() => { releaseRef.current = release; });
  useLayoutEffect(() => {
    const element = root.current;
    if (!exiting || element === null) return;
    if (element.contains(document.activeElement)) (element.nextElementSibling?.querySelector("button") ?? element.previousElementSibling?.querySelector("button"))?.focus();
    if (reduced) { releaseRef.current(); return; }
    gsap.killTweensOf(element);
    const tween = gsap.to(element, { height: 0, opacity: 0, overflow: "hidden", duration: vdMotionDuration("controlState"), ease: VD_MOTION_EASE, onComplete: () => releaseRef.current() });
    return () => { tween.kill(); gsap.set(element, { clearProps: "height,opacity,overflow,transform" }); };
  }, [exiting, reduced]);
  useLayoutEffect(() => {
    const element = check.current;
    if (element === null) return;
    if (reduced) { element.style.opacity = entry.checked ? "1" : "0"; return; }
    if (!shownCheck.current) { element.style.opacity = "0"; shownCheck.current = true; }
    const tween = gsap.to(element, { opacity: entry.checked ? 1 : 0, duration: vdMotionDuration("controlState"), ease: VD_MOTION_EASE });
    return () => { tween.kill(); };
  }, [entry.checked, reduced]);
  useLayoutEffect(() => {
    const element = flash.current;
    const changed = oldLabel.current !== entry.label;
    oldLabel.current = entry.label;
    if (!changed || element === null || reduced) return;
    const tween = gsap.fromTo(element, { opacity: 1 }, { opacity: 0, duration: vdMotionDuration("dialog"), ease: VD_MOTION_EASE, onComplete: () => clearMotion(element) });
    return () => { tween.kill(); clearMotion(element); };
  }, [entry.label, reduced]);
  useLayoutEffect(() => {
    const element = input.current;
    if (!editing || element === null) return;
    element.focus(); element.select();
    if (reduced) return;
    gsap.fromTo(element, { opacity: 0 }, { opacity: 1, duration: vdMotionDuration("controlState"), ease: VD_MOTION_EASE, onComplete: () => clearMotion(element) });
    return () => { gsap.killTweensOf(element); clearMotion(element); };
  }, [editing, reduced]);
  useLayoutEffect(() => { const element = check.current; return () => { if (element !== null) element.style.opacity = ""; }; }, []);
  useLayoutEffect(() => { const element = tools.current; return () => { if (element !== null) { gsap.killTweensOf(element); clearMotion(element); } }; }, []);
  function showTools(show: boolean) {
    const element = tools.current;
    if (element === null) return;
    if (window.matchMedia?.("(hover: none)").matches) show = true;
    gsap.killTweensOf(element);
    if (reduced) { element.style.opacity = show ? "1" : ""; return; }
    gsap.to(element, { opacity: show ? 1 : 0, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE });
  }
  async function save() {
    if (saving || entry.onRename === undefined) return;
    setSaving(true);
    let message: string | null;
    try { message = await entry.onRename(draft); } catch { message = t("workspace.error.failed"); }
    setSaving(false);
    if (message !== null) { setError(message); input.current?.focus(); return; }
    endEdit();
  }
  function endEdit() {
    const element = input.current;
    const finish = () => { setEditing(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); };
    if (reduced || element === null) { finish(); return; }
    gsap.killTweensOf(element);
    gsap.to(element, { opacity: 0, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE, onComplete: finish });
  }
  return <div ref={root} className="vela-workspace-menu-row" data-exiting={exiting || undefined} inert={exiting || undefined} aria-hidden={exiting || undefined}
    onMouseEnter={() => showTools(true)} onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) showTools(false); }}
    onFocus={() => showTools(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) showTools(false); }}>
    <span ref={flash} className="vela-workspace-name-flash" aria-hidden="true" />
    <button type="button" role={mobile ? undefined : entry.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={mobile ? undefined : entry.checked} aria-current={mobile && entry.checked ? "true" : undefined}
      className="vela-context-menu__item" disabled={entry.disabled} title={entry.reason} onClick={onSelect}
      aria-describedby={showHint ? hintId : undefined}>
      {entry.checked === undefined ? null : <span ref={check} className="vela-context-menu__check" data-checked={entry.checked} aria-hidden="true">✓</span>}
      <span className="vela-workspace-menu-name">{entry.label}</span>
    </button>
    {/* A disabled row whose only explanation is a tooltip is invisible on touch and to
        anyone who never hovers: show the reason (e.g. the 10-workspace limit) inline. */}
    {showHint ? <span id={hintId} className="vela-workspace-menu-hint">{entry.reason}</span> : null}
    {editing ? <form className="vela-workspace-rename" onSubmit={event => { event.preventDefault(); void save(); }}>
      <input ref={input} aria-label={entry.tools?.find(tool => tool.icon === "rename")?.label} value={draft} maxLength={40} readOnly={saving} aria-busy={saving}
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); endEdit(); } }} />
      <button type="submit" disabled={saving} aria-label={t("common.save")}>✓</button>
      {error !== null ? <span role="alert">{error}</span> : null}
    </form> : null}
    {entry.tools === undefined ? null : <span ref={tools} className="vela-workspace-menu-tools">
      {entry.tools.map(tool => <span key={tool.icon} title={tool.reason ?? tool.label}>
        <button type="button" aria-label={tool.label} title={tool.reason ?? tool.label} disabled={tool.disabled}
          onClick={() => { if (!mobile && tool.icon === "rename" && entry.onRename !== undefined) { setDraft(entry.label); setError(null); setEditing(true); } else onTool(tool.onSelect); }}>
          {tool.icon === "rename" ? <Pencil size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
        </button>
      </span>)}
    </span>}
  </div>;
}
