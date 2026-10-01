/**
 * Recognition request controller (task 020-A §30–§32).
 *
 * Framework-free debounce + race-safety + dedupe, so every guarantee is
 * unit-testable without React:
 *  - a valid URL schedules ONE request after the shared ~400ms debounce;
 *  - every new fire ABORTS the in-flight request AND stamps a monotonic
 *    sequence id — a late response from a superseded request can never
 *    overwrite the current one (§31);
 *  - the last requested normalized URL is remembered, so rerenders and
 *    equivalent retypes issue no duplicate request (§32);
 *  - "Recognize again" bypasses the dedupe explicitly (§29);
 *  - unrecognizable input (mid-typing, custom protocols) schedules
 *    nothing and aborts anything in flight.
 */

import { normalizeAppRecognitionUrl } from "./normalize-url";
import type { AppRecognitionRequestOutcome, RecognitionSend } from "./recognition-client";

/** One shared constant — paste and typing land on the same delay. */
export const APP_RECOGNITION_DEBOUNCE_MS = 400;

export interface RecognitionControllerCallbacks {
  readonly onStarted: () => void;
  readonly onOutcome: (outcome: AppRecognitionRequestOutcome) => void;
}

export interface RecognitionControllerDeps {
  readonly send: RecognitionSend;
  readonly schedule?: (callback: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export class AppRecognitionController {
  private readonly callbacks: RecognitionControllerCallbacks;
  private readonly send: RecognitionSend;
  private readonly schedule: (callback: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private timer: unknown = null;
  private abortController: AbortController | null = null;
  private seq = 0;
  private lastRequested: string | null = null;
  private currentNormalized: string | null = null;
  private disposed = false;

  constructor(callbacks: RecognitionControllerCallbacks, deps: RecognitionControllerDeps) {
    this.callbacks = callbacks;
    this.send = deps.send;
    this.schedule = deps.schedule ?? ((callback, ms) => setTimeout(callback, ms));
    this.cancel = deps.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /**
   * Called for every URL input change (typing, paste, programmatic).
   *
   * Re-arms a disposed controller: React dev StrictMode runs mount effects,
   * then their cleanups (dispose), then the SAME effects again on the same
   * memoized instance. Disposing must cancel in-flight work without being
   * terminal — after a real unmount nobody calls in again, so this only
   * ever revives a live session.
   */
  onUrlInput(input: string): void {
    this.disposed = false;
    this.clearTimer();
    const normalized = normalizeAppRecognitionUrl(input);
    if (!normalized.ok) {
      this.currentNormalized = null;
      return;
    }
    this.currentNormalized = normalized.normalizedUrl;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.fire(false);
    }, APP_RECOGNITION_DEBOUNCE_MS);
  }

  /** Explicit "Recognize again": immediate, dedupe-bypassing. */
  requestAgain(): void {
    if (this.currentNormalized === null) {
      return;
    }
    this.clearTimer();
    this.disposed = false;
    void this.fire(true);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.abortController?.abort();
  }

  private async fire(force: boolean): Promise<void> {
    const target = this.currentNormalized;
    if (target === null || this.disposed) {
      return;
    }
    if (!force && target === this.lastRequested) {
      return;
    }
    this.lastRequested = target;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const seq = ++this.seq;
    this.callbacks.onStarted();
    let outcome: AppRecognitionRequestOutcome;
    try {
      outcome = await this.send(target, controller.signal);
    } catch {
      return; // the sender does not throw; belt only
    }
    if (this.disposed || seq !== this.seq || controller.signal.aborted) {
      return;
    }
    this.callbacks.onOutcome(outcome);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }
}
