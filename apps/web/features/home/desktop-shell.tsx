/**
 * Thin composition entry (P1-ENG-1): the desktop shell now lives in three
 * layers under this directory — `shell/` (composition + surface state),
 * `scene/` (wallpaper + section-switch choreography, GSAP-owned) and
 * `tile-host/` (one section's tiles, gestures, geometry commits). This
 * module keeps the historical import path (`./desktop-shell`) and its
 * export surface EXACTLY as they were.
 */
export { DesktopShell } from "./shell/desktop-shell";
export type {
  DesktopMode,
  ContextMenuTarget,
  HomeDialog,
} from "./shell/shell-context";
