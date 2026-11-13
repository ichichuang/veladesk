"use client";

import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { useGSAP } from "@gsap/react";

/**
 * The ONE GSAP entry for VelaDesk (task 022): every product animation
 * imports `gsap` and `useGSAP` from here, never from the package directly,
 * so registration happens exactly once and an import scan can audit
 * animation ownership. Core + CSSPlugin + CustomEase are used — no other
 * plugin is registered beyond the React integration.
 *
 * Client-module only: server recognition, DNS, asset and domain packages
 * never import this file. Safe to evaluate during SSR — `gsap` guards its
 * global access, and no tween is created outside effects.
 */
gsap.registerPlugin(useGSAP, CustomEase);

/**
 * The editing-window curves (t171 motion spec), registered as exact
 * cubic-bezier eases once per session:
 *  - open  cubic-bezier(0.2, 0, 0, 1) — a fast take-off with a long glide;
 *  - close cubic-bezier(0.4, 0, 1, 1) — an accelerating leave.
 */
export const VD_EASE_WINDOW_OPEN = CustomEase.create("vdWindowOpen", "M0,0 C0.2,0 0,1 1,1");
export const VD_EASE_WINDOW_CLOSE = CustomEase.create("vdWindowClose", "M0,0 C0.4,0 1,1 1,1");

/** The ticker's default lag smoothing and frame rate are left untouched. */
export { gsap, useGSAP };
