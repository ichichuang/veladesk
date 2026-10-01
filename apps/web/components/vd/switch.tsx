"use client";

import { Switch as HeroUISwitch } from "@heroui/react";
import { useLayoutEffect, useRef } from "react";
import type { ComponentProps } from "react";

import { gsap } from "./gsap";
import { VD_MOTION_EASE, vdMotionDuration } from "./motion-tokens";
import { useVdReducedMotion } from "./reduced-motion";

/**
 * The canonical controlled boolean switch for the HeroUI pilot surfaces
 * (task 020-A1 §14–§15).
 *
 * HeroUI's `Switch` root is React Aria's `SwitchField` — a STATIC field
 * wrapper. The clickable element is `Switch.Content` (React Aria's
 * `SwitchButton`), the only place that renders the hidden `<input>` the
 * switch state binds to. `Switch.Control` and `Switch.Thumb` are plain
 * styled spans: a bare `<Switch><Switch.Control/><Switch.Thumb/></Switch>`
 * composite renders ZERO interactive elements, so `isSelected`/`onChange`
 * can never fire — the exact 020-A1 regression where both production
 * switches looked designed but did nothing. All production switches MUST
 * render through this wrapper so the composition stays in one place.
 *
 * Task 022: the thumb travel is GSAP-owned. HeroUI's installed style
 * transitions the thumb's margin and the track's background over CSS —
 * on this exact slot those transitions are disabled (scoped override in
 * `vd-ui.css`, keyed on `data-vd-switch-gsap`) and the state flips are
 * instant static changes; GSAP then interpolates ONLY the thumb's travel
 * from its previous visual position. `clearProps: "transform"` on
 * completion keeps the thumb clean for HeroUI's own (non-animated) state
 * styling. Reduced motion: instant states, no interpolation.
 */
export type VdSwitchProps = ComponentProps<typeof HeroUISwitch>;

export function VdSwitch({ isSelected, ...props }: VdSwitchProps) {
  const reducedMotion = useVdReducedMotion();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  /** The thumb's visual x one render ago (its position BEFORE the flip). */
  const previousXRef = useRef<number | null>(null);
  const previousSelectedRef = useRef<boolean>(isSelected === true);

  const queryThumb = () =>
    rootRef.current?.querySelector<HTMLElement>(".switch__thumb") ?? null;

  // Capture the thumb's current position on EVERY render: when a state
  // flip lands, this ref still holds where the thumb visually was. One
  // small layout read per render of a leaf control — never per frame.
  useLayoutEffect(() => {
    const thumb = queryThumb();
    if (thumb === null) {
      return;
    }
    previousXRef.current = thumb.getBoundingClientRect().left;
  });

  // Interpolate the flip: the new margin (from the class flip) is already
  // committed; start the thumb at the OLD visual offset and settle to 0.
  useLayoutEffect(() => {
    const selected = isSelected === true;
    const previous = previousSelectedRef.current;
    previousSelectedRef.current = selected;
    const thumb = queryThumb();
    if (thumb === null || previous === selected) {
      return;
    }
    if (reducedMotion) {
      gsap.set(thumb, { x: 0 });
      return;
    }
    const currentX = thumb.getBoundingClientRect().left;
    const previousX = previousXRef.current;
    const delta =
      previousX !== null && Number.isFinite(previousX) ? previousX - currentX : 0;
    if (Math.abs(delta) < 0.5) {
      return;
    }
    const tween = gsap.fromTo(
      thumb,
      { x: delta },
      {
        x: 0,
        duration: vdMotionDuration("controlState"),
        ease: VD_MOTION_EASE,
        overwrite: "auto",
        clearProps: "transform",
      },
    );
    return () => {
      tween.kill();
    };
  }, [isSelected, reducedMotion]);

  return (
    <span ref={rootRef} style={{ display: "contents" }}>
      <HeroUISwitch data-vd-switch-gsap="" {...(props as VdSwitchProps)} isSelected={isSelected === true}>
        <HeroUISwitch.Content>
          <HeroUISwitch.Control>
            <HeroUISwitch.Thumb />
          </HeroUISwitch.Control>
        </HeroUISwitch.Content>
      </HeroUISwitch>
    </span>
  );
}
