import type { DragDropManager } from "@dnd-kit/react";

/**
 * Disables @dnd-kit's decorative drop animation through the official
 * public API: the Feedback plugin instance's `dropAnimation` accessor,
 * where `null` is documented as "disable the drop animation entirely"
 * (the default is a 250ms ease that keeps drifting the dragged element
 * after the destination cell already painted).
 *
 * Product decision (014-D §13): pointer release means snapped and
 * completely still — no bounce, no lift, no settle. The pointer-follow
 * transform during the drag is the Feedback plugin's move phase and is
 * not affected by this. Lives in its own module because the mutation is
 * intentionally imperative plugin configuration, not component state.
 */
export function disableDndDropAnimation(manager: DragDropManager): void {
  for (const plugin of manager.plugins) {
    // The Feedback plugin is the only default plugin exposing `dropAnimation`.
    if ("dropAnimation" in plugin) {
      (plugin as { dropAnimation: unknown }).dropAnimation = null;
    }
  }
}
