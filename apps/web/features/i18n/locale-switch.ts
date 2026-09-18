import type { UiLocale } from "./locale";

/** One side of the compact topbar 中/EN switch. */
export interface LocaleSwitchButton {
  readonly locale: UiLocale;
  /** Endonym glyph — identical in every UI language by design. */
  readonly label: string;
  /** Whether this side is the active locale. */
  readonly pressed: boolean;
}

/**
 * Pure button model for the topbar locale switch (014-E): zh-CN first,
 * en-US second, exactly one pressed side, endonym labels that never
 * change with the active locale.
 */
export function buildLocaleSwitchButtons(active: UiLocale): readonly LocaleSwitchButton[] {
  return [
    { locale: "zh-CN", label: "中", pressed: active === "zh-CN" },
    { locale: "en-US", label: "EN", pressed: active === "en-US" },
  ];
}
