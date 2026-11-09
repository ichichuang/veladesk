/**
 * Typography token constants — the typed JS mirror of the `--vd-font-*`
 * declarations in `packages/ui/src/tokens.css`. Mixed CJK/Latin stacks:
 * Latin leads with Inter, CJK falls through the system SC faces — Chinese
 * text renders one weight step lighter than Latin by design (the SC faces
 * carry more visual weight at the same number).
 *
 * No font FILES ship with the product (no new dependencies): the stacks
 * degrade to the platform default when a family is absent.
 */

/** The sans stack, leading family first. */
export const VD_FONT_SANS_STACK: readonly string[] = [
  "Inter",
  "HarmonyOS Sans SC",
  "PingFang SC",
  "MiSans",
  "system-ui",
  "sans-serif",
];

/** The CSS font-family value of the sans stack. */
export const VD_FONT_SANS: string = VD_FONT_SANS_STACK.join(", ");

/** The mono stack — clock, counts, code-ish metadata. */
export const VD_FONT_MONO_STACK: readonly string[] = [
  "JetBrains Mono",
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Consolas",
  "monospace",
];

/** The CSS font-family value of the mono stack. */
export const VD_FONT_MONO: string = VD_FONT_MONO_STACK.join(", ");

/** The numeric variant value: every digit equally wide. */
export const VD_FONT_NUMERIC = "tabular-nums" as const;
