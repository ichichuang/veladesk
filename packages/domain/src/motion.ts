import type {
  WorkspaceMotionPreferences,
  WorkspacePreferences,
  WorkspaceReducedMotionPreference,
} from "./types";

/**
 * Motion preference resolution (P1).
 *
 * Motion preferences are an OPTIONAL part of `WorkspacePreferences`:
 * legacy snapshots carry none and resolve to the defaults — reduced motion
 * follows the OS preference, every experiment switch is OFF. Resolution is
 * pure and never writes back.
 */

/** The resolved `reducedMotion` default. */
export const DEFAULT_REDUCED_MOTION: WorkspaceReducedMotionPreference = "system";

/** Whether the helm-motion prototype surface (Orbits + Wake) is enabled. */
export function resolveHelmMotionEnabled(preferences: WorkspacePreferences): boolean {
  return preferences.motion?.experiments?.helmMotion === true;
}

/** The persisted `reducedMotion` choice, or `system` for legacy snapshots. */
export function resolveReducedMotionPreference(
  preferences: WorkspacePreferences
): WorkspaceReducedMotionPreference {
  return preferences.motion?.reducedMotion ?? DEFAULT_REDUCED_MOTION;
}

/** Semantic validation of motion values (structurally decoded data). */
export type WorkspaceMotionValidationIssue =
  | { readonly type: "invalid-reduced-motion" }
  | { readonly type: "invalid-motion-experiment" };

/**
 * Deterministic issue order: reducedMotion, experiments.helmMotion.
 * Absent values are valid by definition. Never throws, never mutates.
 */
export function validateWorkspaceMotion(
  motion: WorkspaceMotionPreferences
): readonly WorkspaceMotionValidationIssue[] {
  const issues: WorkspaceMotionValidationIssue[] = [];
  if (
    motion.reducedMotion !== undefined &&
    motion.reducedMotion !== "system" &&
    motion.reducedMotion !== "on" &&
    motion.reducedMotion !== "off"
  ) {
    issues.push({ type: "invalid-reduced-motion" });
  }
  const helmMotion = motion.experiments?.helmMotion;
  if (helmMotion !== undefined && typeof helmMotion !== "boolean") {
    issues.push({ type: "invalid-motion-experiment" });
  }
  return issues;
}
