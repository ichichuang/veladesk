import type { DesktopPageId } from "@veladesk/domain";

/**
 * Per-section scroll memory (task 017): session state only.
 *
 * Before leaving a section, its scroller's scrollTop is remembered;
 * returning to the section restores it. Never persisted into the workspace
 * snapshot, never shared across sessions.
 */

/** Clamps a remembered scrollTop into the CURRENT scroll range. */
export function restoredScrollTop(
  saved: number | undefined,
  scrollTopMax: number,
): number {
  if (saved === undefined || !Number.isFinite(saved) || saved <= 0) {
    return 0;
  }
  if (!Number.isFinite(scrollTopMax) || scrollTopMax <= 0) {
    return 0;
  }
  return Math.min(saved, scrollTopMax);
}

/**
 * The scroll memory of one desktop session. A plain mutable Map behind
 * narrow methods — React state deliberately never models this.
 */
export class SectionScrollMemory {
  private readonly tops = new Map<DesktopPageId, number>();

  save(pageId: DesktopPageId, scrollTop: number): void {
    if (Number.isFinite(scrollTop)) {
      this.tops.set(pageId, Math.max(0, scrollTop));
    }
  }

  recall(pageId: DesktopPageId): number | undefined {
    return this.tops.get(pageId);
  }

  forget(pageId: DesktopPageId): void {
    this.tops.delete(pageId);
  }
}
