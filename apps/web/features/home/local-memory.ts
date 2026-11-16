/**
 * Versioned local memory (task 028): the small shared factory behind the
 * "remember it across sessions" states — the Settings Center's last tab,
 * the icon picker's browse context (see `icon-picker-session.ts`) and the
 * Add/Edit dialog form drafts.
 *
 * The policy is the repo's established pattern (workspace view state, UI
 * locale, selection memory): a versioned key, a strict structural parse,
 * injected Storage for tests, and EVERY failure path degrades to undefined
 * — a broken or quota-blocked store must never break the feature it
 * remembers for. Pure module: no React, no side effects beyond storage.
 */

/** A structural parse for one stored shape. Returns undefined = degrade. */
type Parse<T> = (value: unknown) => T | undefined;

export interface LocalMemory<T> {
  /** Reads the stored value; undefined when absent, stale or broken. */
  readonly read: () => T | undefined;
  /** Writes the value; storage failures are silently ignored. */
  readonly write: (value: T) => void;
  /** Removes the entry. */
  readonly clear: () => void;
}

export function createLocalMemory<T>(
  key: string,
  version: number,
  parse: Parse<T>,
  storage?: Storage
): LocalMemory<T> {
  const store = (): Storage | undefined =>
    storage ?? (typeof window === "undefined" ? undefined : window.localStorage);

  const read = (): T | undefined => {
    const target = store();
    if (target === undefined) {
      return undefined;
    }
    try {
      const raw = target.getItem(key);
      if (raw === null) {
        return undefined;
      }
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        (parsed as Record<string, unknown>).version !== version
      ) {
        return undefined;
      }
      return parse((parsed as Record<string, unknown>).value);
    } catch {
      return undefined;
    }
  };

  const write = (value: T): void => {
    const target = store();
    if (target === undefined) {
      return;
    }
    try {
      target.setItem(key, JSON.stringify({ version, value }));
    } catch {
      // Quota / private-mode failures must never break the feature.
    }
  };

  const clear = (): void => {
    const target = store();
    if (target === undefined) {
      return;
    }
    try {
      target.removeItem(key);
    } catch {
      // Same policy: ignore storage failures.
    }
  };

  return { read, write, clear };
}

/**
 * Session-scoped variant: sessionStorage dies WITH the tab, which is
 * exactly the right horizon for half-typed dialog forms. Same versioned /
 * strict / degrading policy.
 */
export function createSessionMemory<T>(
  key: string,
  version: number,
  parse: Parse<T>,
  storage?: Storage
): LocalMemory<T> {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.sessionStorage);
  return createLocalMemory(key, version, parse, target);
}
