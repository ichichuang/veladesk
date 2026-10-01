/*
 * Vitest browser-API shims for the DOM-hosted component tests
 * (environments: jsdom). Guarded — real environments keep their natives.
 *
 *  - ResizeObserver: jsdom does not implement it; dnd-kit references it at
 *    module scope, so the section-transition integration tests need it
 *    defined before any app module evaluates. A no-op stub is enough:
 *    nothing in the suite observes layout.
 *  - matchMedia: absent in jsdom; Motion's reduced-motion hook and the
 *    shell's prefers-color-scheme probe treat "no matchMedia" as
 *    "no preference" (they check for the API before calling it), so no
 *    stub is installed — this comment documents the deliberate absence.
 */

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

/*
 *  - CSS.escape: also unimplemented in jsdom; react-aria's collection code
 *    and the page-scoped selector helpers rely on it. Minimal WHATWG
 *    algorithm (identifier escaping).
 */
if (
  typeof globalThis.CSS !== "object" ||
  typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function"
) {
  (globalThis as { CSS: { escape: (value: string) => string } }).CSS = {
    ...(typeof globalThis.CSS === "object" ? globalThis.CSS : {}),
    escape(value: string): string {
      return value.replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, (char) => `\\${char}`);
    },
  };
}
