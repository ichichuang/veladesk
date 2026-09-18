/**
 * Minimal template interpolation for UI messages: `{count}`,
 * `{name}`, `{workspace}`-style placeholders are replaced with parameter
 * values. Deliberately not ICU — the product needs named substitution and
 * nothing else. A placeholder without a matching parameter stays literal
 * so missing values stay visible instead of silently deleting text.
 */

export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function formatMessage(template: string, params?: MessageParams): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(PLACEHOLDER, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
