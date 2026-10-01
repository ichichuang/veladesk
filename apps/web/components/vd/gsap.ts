"use client";

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

/**
 * The ONE GSAP entry for VelaDesk (task 022): every product animation
 * imports `gsap` and `useGSAP` from here, never from the package directly,
 * so registration happens exactly once and an import scan can audit
 * animation ownership. Only core + CSSPlugin are used — no plugins are
 * registered beyond the React integration.
 *
 * Client-module only: server recognition, DNS, asset and domain packages
 * never import this file. Safe to evaluate during SSR — `gsap` guards its
 * global access, and no tween is created outside effects.
 */
gsap.registerPlugin(useGSAP);

/** The ticker's default lag smoothing and frame rate are left untouched. */
export { gsap, useGSAP };
