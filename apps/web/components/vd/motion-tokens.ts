/**
 * Canonical motion tokens — moved to @veladesk/ui (P1-ENG-1); this module
 * is now a re-export shim so every existing `@components/vd/motion-tokens`
 * import keeps working unchanged. The token source of truth is
 * `@veladesk/ui`'s `src/tokens/motion.ts`.
 */
export {
  VD_MOTION,
  VD_MOTION_EASE,
  VD_MOTION_EASES,
  VD_MOTION_FLIP,
  VD_MOTION_WALLPAPER,
  vdMotionDuration,
  type VdMotionDurationSeconds,
  type VdMotionEaseName,
  type VdMotionEaseRole,
  type VdMotionPreset,
} from "@veladesk/ui";
