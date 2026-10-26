import type { MouseEvent } from "react";
import type { AppShortcut, WorkspaceEntity } from "@veladesk/domain";

/** Intercept activation only; pointer events remain available for dragging. */
export function handleAppearanceAppClick(
  event: MouseEvent,
  open: boolean,
  editingId: string | null,
  entities: readonly WorkspaceEntity[],
  onSelect: (app: AppShortcut) => void,
): void {
  if (!open || !(event.target instanceof Element)) {
    return;
  }
  const id = event.target.closest("[data-appearance-app-id]")?.getAttribute("data-appearance-app-id");
  const app = entities.find((entity) => entity.id === id);
  if (app?.kind !== "app") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (app.id !== editingId) {
    onSelect(app);
  }
}
