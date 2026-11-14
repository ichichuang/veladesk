"use client";

import { createContext, useContext } from "react";

/**
 * The Engineering-mode context (t181).
 *
 * Default = full editing UI: standalone renders (unit tests, story-style
 * hosts, lab canvases) keep today's behavior unless a host explicitly
 * mounts the {@link EngineeringModeGate} provider. The production home
 * wraps itself in the gate, so real users boot in Use mode and see
 * editing affordances only after the hidden unlock.
 */

export type EngineeringMode = "use" | "engineering";

/** What one unlock attempt came back with. */
export type EngineeringUnlockOutcome =
  | { readonly outcome: "ok" }
  | { readonly outcome: "wrong" }
  | { readonly outcome: "cooldown"; readonly seconds: number }
  | { readonly outcome: "error" };

export interface EngineeringModeContextValue {
  /** `"use"` — view/launch only; `"engineering"` — the full editing UI. */
  readonly mode: EngineeringMode;
  /** Convenience: editing affordances render/act only while true. */
  readonly engineering: boolean;
  /** The hidden unlock dialog session (rendered by the shells). */
  readonly unlock: {
    readonly open: boolean;
    readonly submit: (password: string) => Promise<EngineeringUnlockOutcome>;
    readonly cancel: () => void;
  };
  /** Explicit exit (flushes in-flight edits first — see the gate). */
  readonly exit: () => void;
}

/**
 * The default context value (full UI, inert unlock surface) — see the
 * module comment for why the fallback is Engineering, not Use.
 */
export const ENGINEERING_MODE_DEFAULT: EngineeringModeContextValue = {
  mode: "engineering",
  engineering: true,
  unlock: {
    open: false,
    submit: async () => ({ outcome: "error" }),
    cancel: () => {},
  },
  exit: () => {},
};

const EngineeringModeContext = createContext<EngineeringModeContextValue>(
  ENGINEERING_MODE_DEFAULT,
);

export function EngineeringModeProvider({
  value,
  children,
}: {
  readonly value: EngineeringModeContextValue;
  readonly children: React.ReactNode;
}) {
  return (
    <EngineeringModeContext.Provider value={value}>{children}</EngineeringModeContext.Provider>
  );
}

/** Reads the effective mode; outside a gate this is the full editing UI. */
export function useEngineeringMode(): EngineeringModeContextValue {
  return useContext(EngineeringModeContext);
}
