/**
 * Generated icon text for an app name: the first one to two code points of
 * the trimmed name, uppercased where the script supports it. No grapheme
 * segmentation library on purpose — two JS code points is the v1 budget.
 */
export function generatedIconText(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return Array.from(trimmed)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
