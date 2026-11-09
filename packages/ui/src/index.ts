/**
 * @veladesk/ui — the self-built UI adapter layer (P1-ENG-1).
 *
 * Current surface: the canonical design tokens. `./tokens.css` carries the
 * `--vd-*`/`--vdu-*` custom properties (imported by the app's global
 * stylesheet); these TS modules are the same values as typed constants for
 * JS consumers. Component adapters (VdTooltip, VdSwitch, …) still live in
 * apps/web/components/vd and move here later — this package must not grow
 * a React dependency before that migration.
 */

export * from "./tokens/motion";
export * from "./tokens/color";
export * from "./tokens/radius";
export * from "./tokens/blur";
export * from "./tokens/glow";
export * from "./tokens/shadow";
export * from "./tokens/font";
export * from "./tokens/type-scale";
export * from "./tokens/material";
