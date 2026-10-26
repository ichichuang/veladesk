export const LAST_WORKSPACE_KEY = "veladesk:v1:last-workspace";
const RECENT_WORKSPACES_KEY = "veladesk:v1:recent-workspaces";
export type WorkspacePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** No module-time browser access; private browsing and quota errors are harmless. */
export function createSelectionMemory(storage?: WorkspacePreferenceStorage | null) {
  function resolve() {
    if (storage !== undefined) return storage;
    try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
  }
  function read(key: string): string | null {
    try { return resolve()?.getItem(key) ?? null; } catch { return null; }
  }
  function write(key: string, value: string) {
    try { resolve()?.setItem(key, value); } catch { /* preference storage is optional */ }
  }
  function recent(): string[] {
    try {
      const value: unknown = JSON.parse(read(RECENT_WORKSPACES_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 10) : [];
    } catch { return []; }
  }
  let ids = recent();
  return {
    last: () => read(LAST_WORKSPACE_KEY),
    recent: () => ids,
    remember(id: string) {
      ids = [id, ...ids.filter(other => other !== id)].slice(0, 10);
      write(LAST_WORKSPACE_KEY, id);
      write(RECENT_WORKSPACES_KEY, JSON.stringify(ids));
    },
    forget(id: string) {
      ids = ids.filter(other => other !== id);
      write(RECENT_WORKSPACES_KEY, JSON.stringify(ids));
    },
  };
}
