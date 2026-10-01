"use client";

import { useEffect, useMemo } from "react";
import type { Dispatch } from "react";

import { createRecognitionSender } from "./recognition-client";
import { AppRecognitionController } from "./recognition-controller";
import type { SmartAddAction } from "./smart-add-state";

/**
 * Wires the recognition controller into the Add-App form: URL input
 * changes flow through the debounce, outcomes land as reducer actions,
 * and unmount/dispose aborts anything in flight. The reducer (not this
 * hook) owns the user-ownership rules.
 */
export function useAppRecognition(
  urlInput: string,
  dispatch: Dispatch<SmartAddAction>
): { readonly recognizeAgain: () => void } {
  const controller = useMemo(
    () =>
      new AppRecognitionController(
        {
          onStarted: () => dispatch({ type: "recognition-started" }),
          onOutcome: (outcome) => {
            if (outcome.ok) {
              dispatch({ type: "recognition-succeeded", result: outcome.result });
            } else {
              dispatch({ type: "recognition-failed", code: outcome.code });
            }
          },
        },
        { send: createRecognitionSender() }
      ),
    // useReducer's dispatch is stable, so the controller is created once.
    [dispatch]
  );

  useEffect(() => {
    controller.onUrlInput(urlInput);
  }, [controller, urlInput]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { recognizeAgain: () => controller.requestAgain() };
}
