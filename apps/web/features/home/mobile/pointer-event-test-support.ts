/*
 * jsdom has no `PointerEvent` (jsdom 26 ships MouseEvent + TouchEvent, no
 * PointerEvent). `fireEvent.pointerDown(el, { pointerType: "touch" })`
 * therefore dispatches a plain `Event`: every `pointerType`/`clientX` field
 * comes back `undefined`, so any code that branches on the pointer TYPE or
 * reads the coordinates is silently inert in tests — the exact failure mode
 * that made the first swipe suite pass for the wrong reasons.
 *
 * This helper installs a minimal but faithful `PointerEvent` polyfill on top
 * of `MouseEvent` (which jsdom does implement), so `pointerType`, `clientX`,
 * `clientY`, `pointerId` and `pressure` arrive as real values. It is a test
 * utility only — product code never imports it.
 */

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly pressure: number;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "";
    this.pressure = init.pressure ?? (init.buttons ? 0.5 : 0);
    this.isPrimary = init.isPrimary ?? true;
  }
}

/** True when the environment already has a usable `PointerEvent`. */
export function hasNativePointerEvent(): boolean {
  return typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "function";
}

/**
 * Install the polyfill. Call from `beforeEach` and restore from `afterEach`
 * (or just leave it — it is only additive in jsdom).
 */
export function installPointerEventPolyfill(): () => void {
  if (hasNativePointerEvent()) {
    return () => {};
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "PointerEvent");
  Object.defineProperty(globalThis, "PointerEvent", {
    value: PointerEventPolyfill,
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, "PointerEvent");
    } else {
      Object.defineProperty(globalThis, "PointerEvent", descriptor);
    }
  };
}

/**
 * Dispatch a real `PointerEvent` of `type` on `target`, so the listeners see
 * every field a touch screen would send. Falls back to the polyfill if the
 * environment has none.
 *
 * `timeStamp` matters for velocity sampling: jsdom dispatches synchronously,
 * so consecutive events would otherwise share a timestamp and any `dt`-based
 * velocity reads as infinite. Passing an explicit stamp lets a test simulate
 * a real sampling cadence.
 */
export function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: {
    readonly pointerId?: number;
    readonly pointerType?: "touch" | "mouse" | "pen";
    readonly clientX?: number;
    readonly clientY?: number;
    readonly buttons?: number;
    readonly timeStamp?: number;
  } = {},
): void {
  const Ctor =
    (globalThis as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
    (PointerEventPolyfill as unknown as typeof PointerEvent);
  const event = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: init.pointerId ?? 1,
    pointerType: init.pointerType ?? "touch",
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    buttons: init.buttons ?? 0,
    isPrimary: true,
  } as PointerEventInit);
  // `timeStamp` is read-only and assigned by the constructor; define it
  // explicitly so the sampler sees the cadence the test asked for.
  Object.defineProperty(event, "timeStamp", {
    value: init.timeStamp ?? event.timeStamp,
    configurable: true,
  });
  target.dispatchEvent(event);
}
