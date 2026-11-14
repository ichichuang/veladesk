"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EngineeringModeProvider } from "./engineering-mode-context";
import type {
  EngineeringMode,
  EngineeringModeContextValue,
  EngineeringUnlockOutcome,
} from "./engineering-mode-context";
import {
  feedEngineeringClickTrain,
  isEngineeringEntryTarget,
  type EngineeringClickTrain,
} from "./entry-target";

/**
 * The Engineering-mode gate (t181): the session owner above the whole
 * home. Default mode is USE (view + launch only); the hidden 7-rapid-click
 * gesture opens the password dialog, the password is verified by the
 * SERVER (`POST /api/v1/engineering/unlock`), and the resulting httpOnly
 * session cookie is what authorizes every mutating API call.
 *
 * Lifecycle:
 *  - BOOT probes the session (`GET …/session`, never refreshing it) so a
 *    reload inside Engineering mode restores it;
 *  - INACTIVITY ends it: 30 min without pointer/key activity exits
 *    locally, and the server's own 30-min idle deadline expires the token
 *    regardless (activity heartbeats refresh the server deadline);
 *  - EXPLICIT EXIT closes in-flight editing surfaces first (the shells
 *    react to the mode flip, which flushes the inspector's pending
 *    autosave), and only revokes the server session ~800ms later so that
 *    flush's PUT still carries a valid cookie — no data loss.
 *
 * Overlays (the badge, the unlock dialog) are NOT rendered here: they
 * render from inside each shell (`EngineeringSurfaces`) so they inherit
 * the themed root and portal into the shared overlay container. This
 * component only owns state, listeners and network.
 */

/** Server-side idle deadline (mirrors ENGINEERING_SESSION_IDLE_MS). */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** How often a busy user reminds the server they are active. */
const HEARTBEAT_MIN_INTERVAL_MS = 60 * 1000;

/** Idle-check cadence (the deadline itself is exact, the check is coarse). */
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;

/**
 * Grace between the local mode flip and the server-side revoke: the
 * inspector's unmount autosave flush (t138) fires as the editing surfaces
 * close, and its PUT must still carry the (still-valid) session cookie.
 */
const EXIT_REVOKE_DELAY_MS = 800;

interface FetchJsonResult {
  readonly status: number;
  readonly body: unknown;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<FetchJsonResult | null> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

function responseBody(result: FetchJsonResult): Record<string, unknown> | null {
  return typeof result.body === "object" && result.body !== null
    ? (result.body as Record<string, unknown>)
    : null;
}

function isActiveStatus(result: FetchJsonResult | null): boolean {
  return result !== null && result.status === 200 && responseBody(result)?.active === true;
}

export function EngineeringModeGate({ children }: { readonly children: ReactNode }) {
  const [mode, setMode] = useState<EngineeringMode>("use");
  const [unlockOpen, setUnlockOpen] = useState(false);
  const modeRef = useRef<EngineeringMode>("use");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // --- Boot probe: a reload inside Engineering mode restores it ---------
  useEffect(() => {
    let cancelled = false;
    void fetchJson("/api/v1/engineering/session").then((result) => {
      if (!cancelled && isActiveStatus(result)) {
        setMode("engineering");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- The hidden entry gesture (7 rapid qualifying clicks) -------------
  useEffect(() => {
    if (mode !== "use") {
      return;
    }
    let train: EngineeringClickTrain = { count: 0, lastClickMs: 0 };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const next = feedEngineeringClickTrain(
        train,
        isEngineeringEntryTarget(target),
        event.timeStamp,
      );
      train = next.state;
      if (next.unlocked) {
        setUnlockOpen(true);
      }
    };
    // Capture phase: a target's own handlers cannot hide the click.
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [mode]);

  // --- Unlock submission (server-verified) -------------------------------
  const submitUnlock = useCallback(async (password: string): Promise<EngineeringUnlockOutcome> => {
    const result = await fetchJson("/api/v1/engineering/unlock", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    if (result === null) {
      return { outcome: "error" };
    }
    if (result.status === 200) {
      setMode("engineering");
      setUnlockOpen(false);
      return { outcome: "ok" };
    }
    if (result.status === 429) {
      const body = responseBody(result);
      const error = typeof body?.error === "object" && body.error !== null ? body.error : null;
      const seconds =
        error !== null && typeof (error as Record<string, unknown>).retryAfterSec === "number"
          ? (error as Record<string, unknown>).retryAfterSec
          : undefined;
      return {
        outcome: "cooldown",
        seconds: typeof seconds === "number" && seconds > 0 ? seconds : 30,
      };
    }
    return { outcome: "wrong" };
  }, []);

  const cancelUnlock = useCallback(() => {
    setUnlockOpen(false);
  }, []);

  // --- Explicit exit -------------------------------------------------------
  const exit = useCallback(() => {
    if (modeRef.current !== "engineering") {
      return;
    }
    // Flip FIRST: the shells close their editing surfaces, the inspector's
    // unmount flush fires, and the delayed revoke below stays behind it.
    setMode("use");
    window.setTimeout(() => {
      void fetchJson("/api/v1/engineering/session", { method: "DELETE" });
    }, EXIT_REVOKE_DELAY_MS);
  }, []);

  // --- Inactivity + heartbeat ----------------------------------------------
  // (0 = "not started"; the engineering effect seeds the real timestamp.)
  const lastActivityRef = useRef<number>(0);
  const lastHeartbeatRef = useRef<number>(0);

  useEffect(() => {
    if (mode !== "engineering") {
      return;
    }
    lastActivityRef.current = Date.now();
    const noteActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const activityOptions = { capture: true, passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", noteActivity, activityOptions);
    window.addEventListener("keydown", noteActivity, activityOptions);

    const heartbeat = () => {
      const now = Date.now();
      if (now - lastActivityRef.current > HEARTBEAT_MIN_INTERVAL_MS) {
        return; // Idle user: the idle check below ends the session instead.
      }
      if (now - lastHeartbeatRef.current < HEARTBEAT_MIN_INTERVAL_MS) {
        return;
      }
      lastHeartbeatRef.current = now;
      void fetchJson("/api/v1/engineering/session", { method: "POST" });
    };
    const tick = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= SESSION_IDLE_MS) {
        exit();
        return;
      }
      heartbeat();
    }, IDLE_CHECK_INTERVAL_MS);

    // Returning to the tab revalidates the server's own view (the session
    // may have expired server-side while the tab slept).
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      if (Date.now() - lastActivityRef.current >= SESSION_IDLE_MS) {
        exit();
        return;
      }
      void fetchJson("/api/v1/engineering/session").then((result) => {
        if (!isActiveStatus(result) && modeRef.current === "engineering") {
          setMode("use");
        }
      });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pointerdown", noteActivity, activityOptions);
      window.removeEventListener("keydown", noteActivity, activityOptions);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode, exit]);

  const value = useMemo<EngineeringModeContextValue>(
    () => ({
      mode,
      engineering: mode === "engineering",
      unlock: { open: unlockOpen, submit: submitUnlock, cancel: cancelUnlock },
      exit,
    }),
    [mode, unlockOpen, submitUnlock, cancelUnlock, exit],
  );

  return <EngineeringModeProvider value={value}>{children}</EngineeringModeProvider>;
}
