"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { gsap } from "@components/vd/gsap";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { vdMotionDuration, VD_MOTION_EASE } from "@components/vd/motion-tokens";
import { useI18n } from "../i18n/use-i18n";
import { useEngineeringMode } from "./engineering-mode-context";
import { EngineeringPasswordDialog } from "./engineering-password-dialog";
import "./engineering.css";

/**
 * The Engineering-mode overlays each shell mounts INSIDE its themed root
 * (t181): the 「工程模式」 indicator while unlocked, and the password
 * dialog while unlocking. Both are FIXED overlays — Chris's binding rule
 * holds: nothing that appears or disappears here may shift any tile,
 * section, pill or grid by a pixel.
 *
 * The badge fades in on the hoverPress token when Engineering mode is
 * entered (the one persistent affordance the mode adds) and its click
 * exits the mode — the gate flushes in-flight editing state first.
 */
export function EngineeringSurfaces() {
  const { engineering, unlock, exit } = useEngineeringMode();
  const reducedMotion = useVdReducedMotion();

  // The unlock dialog's mounted presence: the close intent (open=false)
  // plays the 160ms exit first; only its completion unmounts. The rising
  // open edge mounts during render (the sanctioned state adjustment —
  // same contract as useVdPresence, kept local for the extra submit pass).
  const [dialogMounted, setDialogMounted] = useState(unlock.open);
  if (unlock.open && !dialogMounted) {
    setDialogMounted(true);
  }

  return (
    <>
      {engineering ? <EngineeringBadge onExit={exit} reducedMotion={reducedMotion} /> : null}
      {dialogMounted ? (
        <EngineeringPasswordDialog
          open={unlock.open}
          onExitComplete={() => setDialogMounted(false)}
          onCancel={unlock.cancel}
          onSubmitPassword={unlock.submit}
        />
      ) : null}
    </>
  );
}

/**
 * The fixed 「工程模式」 indicator (top-right, both shells). Entering the
 * mode fades it in; clicking (or Enter/Space — it is a real button) exits.
 */
function EngineeringBadge({
  onExit,
  reducedMotion,
}: {
  readonly onExit: () => void;
  readonly reducedMotion: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement | null>(null);

  // The entrance fade (opacity only — never transform, never layout).
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    if (reducedMotion) {
      gsap.set(element, { opacity: 1 });
      return;
    }
    gsap.fromTo(
      element,
      { opacity: 0 },
      { opacity: 1, duration: vdMotionDuration("hoverPress"), ease: VD_MOTION_EASE },
    );
  }, [reducedMotion]);

  return (
    <button
      ref={ref}
      type="button"
      className="vela-engineering-badge"
      data-vd-engineering-badge=""
      title={t("engineering.badge.exitHint")}
      aria-label={t("engineering.badge.exitHint")}
      onClick={onExit}
    >
      <span className="vela-engineering-badge__dot" aria-hidden="true" />
      {t("engineering.badge")}
    </button>
  );
}
