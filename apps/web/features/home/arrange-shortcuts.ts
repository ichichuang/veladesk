/**
 * Pure resolution of the arrange history keyboard shortcuts.
 *
 * The undo/redo chords must only be consumed (preventDefault) when the
 * command is actually executable — an unavailable undo must stay free for
 * the browser/OS. Keeping the decision in a pure helper makes the modifier
 * and availability matrix testable without a DOM.
 */

/** The history command a chord resolves to, when it may fire at all. */
export type ArrangeHistoryCommand = "undo" | "redo";

/** Everything the resolution depends on: the event's modifiers plus the page's current history availability. */
export interface ArrangeShortcutInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * Resolves a keydown to a history command, or `null` when the chord is not
 * ours or the command is unavailable (the caller must then leave the event
 * alone — no preventDefault, no state change).
 *
 * - Ctrl/Cmd+Z → undo iff undo is available
 * - Ctrl/Cmd+Shift+Z → redo iff redo is available
 * - Ctrl+Y → redo iff redo is available (Cmd+Y is not ours)
 * - Alt modifies nothing we own; plain keys and other chords → null
 */
export function resolveArrangeHistoryCommand(
  input: ArrangeShortcutInput,
): ArrangeHistoryCommand | null {
  if (input.altKey || !(input.ctrlKey || input.metaKey)) {
    return null;
  }
  const key = input.key.toLowerCase();
  if (key === "z") {
    if (input.shiftKey) {
      return input.canRedo ? "redo" : null;
    }
    return input.canUndo ? "undo" : null;
  }
  if (key === "y" && input.ctrlKey && !input.metaKey) {
    return input.canRedo ? "redo" : null;
  }
  return null;
}
