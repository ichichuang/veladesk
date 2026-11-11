"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { MotionToast, MotionToastStack } from "./motion-toast";

/**
 * Launch feedback (UX-04): one quiet toast channel for launch refusals
 * (a stored URL that no longer parses — legacy free-text data — or a
 * popup the browser blocked). The desktop shell provides it; any surface
 * without a provider (the desktop lab, unit tests) gets a no-op, so
 * callers never need to know whether a shell is listening.
 */

const LaunchFeedbackContext = createContext<(message: string) => void>(() => {});

export function useLaunchFeedback(): (message: string) => void {
  return useContext(LaunchFeedbackContext);
}

/** Provides + renders the channel (the shell mounts this once). */
export function LaunchFeedbackSurface({ children }: { readonly children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  // Re-showing the same refusal must replay the toast: the key forces a
  // fresh MotionToast instance instead of a no-op state write.
  const [occurrence, setOccurrence] = useState(0);
  const notify = useCallback((next: string) => {
    setMessage(next);
    setOccurrence((current) => current + 1);
  }, []);
  const value = useMemo(() => notify, [notify]);
  return (
    <LaunchFeedbackContext.Provider value={value}>
      {children}
      <MotionToastStack>
        {message !== null ? (
          <MotionToast key={occurrence} onDismiss={() => setMessage(null)} slot="workspace">
            {message}
          </MotionToast>
        ) : null}
      </MotionToastStack>
    </LaunchFeedbackContext.Provider>
  );
}
