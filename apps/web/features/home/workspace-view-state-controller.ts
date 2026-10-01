import {
  WORKSPACE_VIEW_STATE_VERSION,
  loadWorkspaceViewState,
  saveWorkspaceViewState,
  type WorkspaceViewStateV1,
} from "./workspace-view-state";

/**
 * The workspace view-state persistence controller (task 023-A): one
 * workspace's in-memory view state plus a COALESCED local write. No React,
 * no DOM — the shell feeds it logical events and owns the lifecycle
 * (pagehide binding, unmount capture) through the plain methods below.
 *
 * Timing contract: mutators update memory synchronously (the desktop's
 * state never waits on storage) and schedule ONE deferred flush; whichever
 * mutation happened last wins, because the flush always serializes the
 * current memory. The deferral is the platform's idle opportunity with a
 * hard cap — `requestIdleCallback(timeout)` where available, a ~200ms
 * timer otherwise — never a long debounce. `flushNow` writes synchronously
 * for lifecycle boundaries (pagehide, workspace exit), and a write failure
 * is swallowed: continuity degrades, the desktop never notices.
 */

/** The maximum coalescing window before a scheduled flush MUST run. */
export const VIEW_STATE_FLUSH_MAX_DELAY_MS = 200;

/** Schedules a callback to run soon-ish; returns its cancel function. */
export type ViewStateFlushScheduler = (callback: () => void) => () => void;

/**
 * The browser scheduler: idle when the platform offers it, a capped timer
 * otherwise (Safari has no requestIdleCallback). The timeout option makes
 * idle starvation impossible — the callback fires by the cap regardless.
 */
export function browserIdleFlushScheduler(): ViewStateFlushScheduler {
  if (typeof requestIdleCallback === "function") {
    return (callback) => {
      const handle = requestIdleCallback(callback, {
        timeout: VIEW_STATE_FLUSH_MAX_DELAY_MS,
      });
      return () => cancelIdleCallback(handle);
    };
  }
  return (callback) => {
    const timer = setTimeout(callback, VIEW_STATE_FLUSH_MAX_DELAY_MS);
    return () => clearTimeout(timer);
  };
}

/** The controller surface consumed by the shell. */
export interface WorkspaceViewStateController {
  /** Records the logically accepted active section (the user's destination). */
  setActiveSection(sectionId: DesktopSectionId): void;
  /** Records one section's remembered scrollTop. */
  setScrollTop(sectionId: DesktopSectionId, scrollTop: number): void;
  /** The current in-memory state (latest mutation wins). */
  readonly current: () => WorkspaceViewStateV1;
  /** Writes synchronously right now (pagehide / workspace exit). */
  flushNow(): void;
  /** Cancels the scheduled flush. The shell flushes first if it wants a final write. */
  dispose(): void;
}

/** String ids only — kept structural so the module stays domain-import-free. */
type DesktopSectionId = string | null;

export function createWorkspaceViewStateController(input: {
  readonly workspaceId: string;
  /** Injected storage; null/undefined disables disk entirely (in-memory only). */
  readonly storage?: Storage | null | undefined;
  /**
   * The state to start from — normally the shell's boot composition: the
   * persisted payload with the RESOLVED initial section already overlaid
   * (a stale persisted section is repaired in memory at boot; the repair
   * reaches disk on the next flush, pagehide included).
   */
  readonly initial?: WorkspaceViewStateV1 | undefined;
  /** Clock seam; defaults to Date.now. */
  readonly now?: (() => number) | undefined;
  /** Scheduler seam for deterministic tests; defaults to the browser scheduler. */
  readonly schedule?: ViewStateFlushScheduler | undefined;
}): WorkspaceViewStateController {
  const { workspaceId, storage = null } = input;
  const now = input.now ?? (() => Date.now());
  const schedule = input.schedule ?? browserIdleFlushScheduler();
  let state: WorkspaceViewStateV1 =
    input.initial ??
    (storage === null || storage === undefined
      ? {
          version: WORKSPACE_VIEW_STATE_VERSION,
          activeSectionId: null,
          scrollTopBySectionId: {},
          updatedAt: 0,
        }
      : (loadWorkspaceViewState(storage, workspaceId) ?? {
          version: WORKSPACE_VIEW_STATE_VERSION,
          activeSectionId: null,
          scrollTopBySectionId: {},
          updatedAt: 0,
        }));
  let cancelScheduled: (() => void) | null = null;
  let disposed = false;

  function runFlush(): void {
    cancelScheduled = null;
    writeState();
  }

  function writeState(): void {
    if (disposed || storage === null || storage === undefined) {
      return;
    }
    // Write failures are continuity loss, never desktop failure.
    saveWorkspaceViewState(storage, workspaceId, state);
  }

  function scheduleFlush(): void {
    if (disposed || cancelScheduled !== null) {
      return;
    }
    cancelScheduled = schedule(runFlush);
  }

  return {
    setActiveSection(sectionId) {
      if (disposed || state.activeSectionId === sectionId) {
        return;
      }
      state = { ...state, activeSectionId: sectionId, updatedAt: now() };
      scheduleFlush();
    },

    setScrollTop(sectionId, scrollTop) {
      if (
        disposed ||
        sectionId === null ||
        !Number.isFinite(scrollTop) ||
        scrollTop < 0 ||
        state.scrollTopBySectionId[sectionId] === scrollTop
      ) {
        return;
      }
      state = {
        ...state,
        scrollTopBySectionId: {
          ...state.scrollTopBySectionId,
          [sectionId]: scrollTop,
        },
        updatedAt: now(),
      };
      scheduleFlush();
    },

    current() {
      return state;
    },

    flushNow() {
      if (cancelScheduled !== null) {
        cancelScheduled();
        cancelScheduled = null;
      }
      writeState();
    },

    dispose() {
      disposed = true;
      if (cancelScheduled !== null) {
        cancelScheduled();
        cancelScheduled = null;
      }
    },
  };
}
