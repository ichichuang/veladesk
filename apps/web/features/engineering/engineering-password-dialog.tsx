"use client";

import { useLayoutEffect, useRef, useState, type FormEvent } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { gsap } from "@components/vd/gsap";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { vdMotionDuration } from "@components/vd/motion-tokens";
import { useI18n } from "../i18n/use-i18n";
import type { EngineeringUnlockOutcome } from "./engineering-mode-context";
import "../home/home-shell.css";

/**
 * The Engineering-mode unlock dialog (t181): the SAME editor-window motion
 * contract as the t171 visual editor (DialogContent `motionPreset="editor"`
 * — rise 240ms / close 160ms; reduced motion = opacity-only 120ms), a
 * single autofocus 6-digit numeric field, Enter submits, Esc/backdrop
 * cancels (Radix semantics).
 *
 * A wrong password shakes the window briefly (GSAP x keyframes on the
 * controlState token; a no-op under reduced motion), clears the field and
 * shows the inline 「密码不正确」. Five consecutive failures put unlocking
 * on a 30s cooldown — enforced SERVER-side; this surface only mirrors the
 * remaining seconds the server reports.
 */
export function EngineeringPasswordDialog({
  open,
  onExitComplete,
  onCancel,
  onSubmitPassword,
}: {
  readonly open: boolean;
  /** Presence release after the close exit (DialogContent contract). */
  readonly onExitComplete?: (() => void) | undefined;
  readonly onCancel: () => void;
  /** What the unlock attempt came back with. */
  readonly onSubmitPassword: (password: string) => Promise<EngineeringUnlockOutcome>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<
    { readonly kind: "wrong" } | { readonly kind: "cooldown"; readonly seconds: number } | { readonly kind: "network" } | null
  >(null);
  const cooldownSec = notice?.kind === "cooldown" ? notice.seconds : 0;
  const reducedMotion = useVdReducedMotion();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shakeTweenRef = useRef<gsap.core.Tween | null>(null);

  // Cooldown countdown: the server's remaining seconds tick down locally.
  useLayoutEffect(() => {
    if (notice?.kind !== "cooldown") {
      return;
    }
    const seconds = notice.seconds;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setNotice({ kind: "cooldown", seconds: Math.max(0, seconds - elapsed) });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [notice]);

  // The brief wrong-password shake (transform-only; skipped for reduced
  // motion, where meaning is carried by the inline error text alone).
  function shake() {
    if (reducedMotion) {
      return;
    }
    shakeTweenRef.current?.kill();
    shakeTweenRef.current = gsap.fromTo(
      surfaceRef.current,
      { x: 0 },
      {
        keyframes: [{ x: -7 }, { x: 7 }, { x: -4 }, { x: 4 }, { x: 0 }],
        duration: vdMotionDuration("controlState") * 1.4,
        ease: "none",
      },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cooldownSec > 0 || value.length === 0) {
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await onSubmitPassword(value);
    setBusy(false);
    if (result.outcome === "ok") {
      return; // Unlocked — the gate swaps modes and closes this dialog.
    }
    setValue("");
    if (result.outcome === "cooldown") {
      setNotice({ kind: "cooldown", seconds: result.seconds });
    } else if (result.outcome === "wrong") {
      setNotice({ kind: "wrong" });
      shake();
    } else {
      setNotice({ kind: "network" });
    }
    inputRef.current?.focus();
  }

  const disabled = busy || cooldownSec > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent
        onExitComplete={onExitComplete}
        showCloseButton={false}
        motionPreset="editor"
        surfaceTone="solid"
        className="w-[380px] max-w-[calc(100vw-32px)]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <header className="shrink-0 px-5 pb-3 pt-5">
            <DialogTitle className="text-base">{t("engineering.dialog.title")}</DialogTitle>
            <DialogDescription className="mt-1">
              {t("engineering.dialog.description")}
            </DialogDescription>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-2">
            <label className="text-xs text-vdu-fg-muted" htmlFor="veladesk-engineering-password">
              {t("engineering.dialog.passwordLabel")}
            </label>
            <div ref={surfaceRef}>
              <Input
                ref={inputRef}
                id="veladesk-engineering-password"
                // Autofocus with a frame's delay so Radix focus containment
                // has settled before the field grabs focus.
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                maxLength={6}
                disabled={disabled}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value.replace(/[^0-9]/g, "").slice(0, 6));
                  if (notice?.kind === "wrong") {
                    setNotice(null);
                  }
                }}
                className="vela-engineering-password-input text-center tracking-[0.5em]"
              />
            </div>
            {notice?.kind === "cooldown" && notice.seconds > 0 ? (
              <p className="text-xs text-vdu-danger" role="alert">
                {t("engineering.dialog.cooldown", { seconds: notice.seconds })}
              </p>
            ) : notice?.kind === "wrong" ? (
              <p className="text-xs text-vdu-danger" role="alert">
                {t("engineering.dialog.wrong")}
              </p>
            ) : notice?.kind === "network" ? (
              <p className="text-xs text-vdu-danger" role="alert">
                {t("engineering.dialog.network")}
              </p>
            ) : null}
          </div>
          <footer className="flex shrink-0 items-center justify-end gap-2.5 px-5 pb-5 pt-3">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              {t("engineering.dialog.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={disabled || value.length === 0}>
              {busy ? t("engineering.dialog.busy") : t("engineering.dialog.submit")}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
