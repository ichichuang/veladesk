import type { Page } from "@playwright/test";

/**
 * Task 019-A geometry capture: the layout-invariant instrumentation shared
 * by the displacement specs.
 *
 * Every checkpoint records the rects the task-018 failure was observed on
 * (documentElement, body, .vela-desktop, .vela-workbench, .vela-rail,
 * .vela-workspace), the computed styles that could displace an in-flow
 * child (collected on .vela-workbench AND every DOM ancestor up to <html>),
 * and — the proven 019-A signal — the latched programmatic scroll of the
 * overflow-clipped .vela-desktop stage together with its scrollable
 * overflow extents.
 */

export interface RectJson {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AncestorStyle {
  selector: string;
  rect: RectJson;
  computed: Record<string, string>;
}

export interface GeometryCapture {
  label: string;
  viewport: { width: number; height: number };
  documentScroll: { left: number; top: number };
  rects: Record<string, RectJson | null>;
  desktopScroll: { left: number; top: number } | null;
  desktopOverflow: {
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
  } | null;
  ancestors: AncestorStyle[];
}

const COMPUTED_PROPS = [
  "position",
  "display",
  "width",
  "height",
  "margin",
  "padding",
  "transform",
  "translate",
  "scale",
  "zoom",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
  "overflow",
  "contain",
  "container-type",
] as const;

const TRACKED_RECTS = [
  "documentElement",
  "body",
  ".vela-desktop",
  ".vela-workbench",
  ".vela-rail",
  ".vela-workspace",
] as const;

function selectorOf(element: Element): string {
  const classes =
    element instanceof HTMLElement && element.className
      ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
  return `${element.tagName.toLowerCase()}${classes}`;
}

/** Captures the full geometry state in one round-trip. */
export async function captureGeometry(page: Page, label: string): Promise<GeometryCapture> {
  return page.evaluate(
    ({ label, props, trackedRects }) => {
      const rectOf = (el: Element | null): RectJson | null => {
        if (!el) return null;
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      };
      const rects: Record<string, RectJson | null> = {};
      for (const key of trackedRects) {
        rects[key] = rectOf(
          key === "documentElement"
            ? document.documentElement
            : key === "body"
              ? document.body
              : document.querySelector(key),
        );
      }
      const ancestors: AncestorStyle[] = [];
      let node = document.querySelector(".vela-workbench");
      while (node) {
        const computed = getComputedStyle(node);
        const picked: Record<string, string> = {};
        for (const prop of props) {
          picked[prop] = computed.getPropertyValue(prop);
        }
        ancestors.push({ selector: selectorOf(node), rect: rectOf(node)!, computed: picked });
        node = node.parentElement;
      }
      const desktop = document.querySelector(".vela-desktop");
      return {
        label,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentScroll: {
          left: document.documentElement.scrollLeft,
          top: document.documentElement.scrollTop,
        },
        rects,
        desktopScroll: desktop
          ? { left: desktop.scrollLeft, top: desktop.scrollTop }
          : null,
        desktopOverflow: desktop
          ? {
              scrollWidth: desktop.scrollWidth,
              scrollHeight: desktop.scrollHeight,
              clientWidth: desktop.clientWidth,
              clientHeight: desktop.clientHeight,
            }
          : null,
        ancestors,
      };
    },
    { label, props: COMPUTED_PROPS, trackedRects: TRACKED_RECTS },
  );
}

export interface InvariantViolation {
  kind: "origin" | "size" | "desktop-scroll";
  detail: string;
}

/**
 * The 019-A invariant: the workbench fills the viewport from (0,0) —
 * |left| and |top| within 0.5px, size matching the viewport — and the
 * desktop stage carries no latched programmatic scroll.
 */
export function workbenchViolations(capture: GeometryCapture): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const workbench = capture.rects[".vela-workbench"];
  if (!workbench) {
    return [{ kind: "origin", detail: ".vela-workbench not found" }];
  }
  if (Math.abs(workbench.x) > 0.5 || Math.abs(workbench.y) > 0.5) {
    violations.push({
      kind: "origin",
      detail: `workbench at (${workbench.x.toFixed(2)}, ${workbench.y.toFixed(2)}), expected (0, 0) ± 0.5`,
    });
  }
  const widthDelta = Math.abs(workbench.width - capture.viewport.width);
  const heightDelta = Math.abs(workbench.height - capture.viewport.height);
  if (widthDelta > 0.5 || heightDelta > 0.5) {
    violations.push({
      kind: "size",
      detail: `workbench ${workbench.width.toFixed(2)}×${workbench.height.toFixed(2)}, viewport ${capture.viewport.width}×${capture.viewport.height}`,
    });
  }
  if (capture.desktopScroll && (capture.desktopScroll.left !== 0 || capture.desktopScroll.top !== 0)) {
    violations.push({
      kind: "desktop-scroll",
      detail: `.vela-desktop latched scroll (${capture.desktopScroll.left}, ${capture.desktopScroll.top})`,
    });
  }
  return violations;
}

/** Renders a capture as a compact multi-line record for failure output. */
export function formatCapture(capture: GeometryCapture): string {
  const rectLines = Object.entries(capture.rects).map(([key, rect]) => {
    const value = rect
      ? `(${rect.x.toFixed(1)}, ${rect.y.toFixed(1)}) ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`
      : "null";
    return `    ${key.padEnd(18)} ${value}`;
  });
  const ancestorLines = capture.ancestors.map((ancestor) => {
    const interesting = Object.entries(ancestor.computed)
      .filter(([prop, value]) => {
        if (["margin", "padding", "inset", "top", "right", "bottom", "left"].includes(prop)) {
          return value !== "0px";
        }
        return !["none", "normal", "auto", ""].includes(value);
      })
      .map(([prop, value]) => `${prop}=${value}`)
      .join(" ");
    return `    ${ancestor.selector.padEnd(34)} (${ancestor.rect.x.toFixed(0)},${ancestor.rect.y.toFixed(0)}) ${interesting}`;
  });
  const overflow = capture.desktopOverflow
    ? `scroll ${capture.desktopOverflow.scrollWidth}×${capture.desktopOverflow.scrollHeight} vs client ${capture.desktopOverflow.clientWidth}×${capture.desktopOverflow.clientHeight}`
    : "null";
  return [
    `  [${capture.label}] viewport ${capture.viewport.width}×${capture.viewport.height}`,
    `    doc scroll (${capture.documentScroll.left}, ${capture.documentScroll.top}); desktop scroll ${capture.desktopScroll ? `(${capture.desktopScroll.left}, ${capture.desktopScroll.top})` : "null"}; ${overflow}`,
    ...rectLines,
    ...ancestorLines,
  ].join("\n");
}
