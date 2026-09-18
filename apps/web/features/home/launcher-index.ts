import type {
  AppShortcut,
  DesktopPageId,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceSyncState } from "@veladesk/local-store";

import type { LauncherCommandId, LauncherEntry } from "./launcher-types";

/**
 * Deterministic workspace launcher index.
 *
 * `buildLauncherEntries` turns a WorkspaceSnapshot into the full ordered
 * entry list — the empty-query discoverability order:
 *
 *   1. commands (fixed order; the remote command follows sync state)
 *   2. dock items, strictly in `workspace.dock.items` order
 *   3. active-page entities, strictly in layout item order
 *   4. remaining apps/folders, strictly in `workspace.entities` order
 *   5. pages, strictly in `workspace.pages` order
 *
 * Every entity appears at most once (dedupe by entry key, first
 * occurrence wins). Widgets are never indexed — V1 has no unified widget
 * activation semantics. `baseOrder` is the final array index, which makes
 * search tie-breaks fully deterministic.
 */

/** The launcher only exists in a ready desktop shell, so the mode is the shell's own session mode. */
export type LauncherMode = "view" | "arrange";

export interface BuildLauncherEntriesInput {
  readonly workspace: WorkspaceSnapshot;
  readonly activePageId: DesktopPageId | null;
  readonly mode: LauncherMode;
  readonly syncState: LocalWorkspaceSyncState;
}

interface EntryDraft {
  readonly key: string;
  readonly entry: LauncherEntry;
}

const LOCAL_COMMAND_LABELS: Readonly<
  Record<Exclude<LauncherCommandId, "toggle-mode" | "sync-current" | "pull-current">, string>
> = {
  "add-app": "Add App",
  "new-folder": "New Folder",
  "open-settings": "Settings",
};

const MODE_COMMAND: Readonly<Record<LauncherMode, { label: string; secondary: readonly string[] }>> = {
  arrange: { label: "Switch to View", secondary: ["view", "arrange", "layout"] },
  view: { label: "Switch to Arrange", secondary: ["arrange", "edit layout", "move icons"] },
};

export function buildLauncherEntries(
  input: BuildLauncherEntriesInput,
): readonly LauncherEntry[] {
  const { workspace, activePageId, mode, syncState } = input;

  const drafts: EntryDraft[] = [];
  const seen = new Set<string>();

  function push(draft: EntryDraft) {
    if (seen.has(draft.key)) {
      return;
    }
    seen.add(draft.key);
    // Dedupe keeps only the first occurrence, so the running length is
    // exactly this entry's final position and tie-break order.
    drafts.push({
      key: draft.key,
      entry: { ...draft.entry, baseOrder: drafts.length },
    });
  }

  function pushCommand(
    commandId: LauncherCommandId,
    label: string,
    secondary: readonly string[],
  ) {
    push({
      key: `command:${commandId}`,
      entry: {
        kind: "command",
        key: `command:${commandId}`,
        commandId,
        label,
        secondary,
        baseOrder: 0,
      },
    });
  }

  function pushApp(app: AppShortcut) {
    const secondary: string[] = [app.url];
    if (app.description !== undefined) {
      secondary.push(app.description);
    }
    secondary.push(...app.tags);
    if (app.categoryId !== undefined) {
      const category = workspace.categories.find(
        (candidate) => candidate.id === app.categoryId,
      );
      if (category !== undefined) {
        secondary.push(category.name);
      }
    }
    secondary.push("app");
    push({
      key: `app:${app.id}`,
      entry: {
        kind: "app",
        key: `app:${app.id}`,
        entityId: app.id,
        label: app.name,
        secondary,
        baseOrder: 0,
      },
    });
  }

  function pushFolderById(folderId: string) {
    const folder = workspace.entities.find(
      (candidate): candidate is Extract<(typeof workspace.entities)[number], { kind: "folder" }> =>
        candidate.kind === "folder" && candidate.id === folderId,
    );
    if (folder === undefined) {
      return;
    }
    push({
      key: `folder:${folder.id}`,
      entry: {
        kind: "folder",
        key: `folder:${folder.id}`,
        entityId: folder.id,
        label: folder.name,
        secondary: ["folder"],
        baseOrder: 0,
      },
    });
  }

  // 1. Commands — fixed local order; exactly one remote command by sync state.
  pushCommand(
    "add-app",
    LOCAL_COMMAND_LABELS["add-app"],
    ["add app", "new shortcut", "create app"],
  );
  pushCommand(
    "new-folder",
    LOCAL_COMMAND_LABELS["new-folder"],
    ["new folder", "create folder"],
  );
  pushCommand(
    "open-settings",
    LOCAL_COMMAND_LABELS["open-settings"],
    ["settings", "preferences", "appearance", "theme", "desktop"],
  );
  pushCommand(
    "toggle-mode",
    MODE_COMMAND[mode].label,
    MODE_COMMAND[mode].secondary,
  );
  if (syncState === "dirty") {
    pushCommand("sync-current", "Sync Now", ["sync", "save", "upload", "server"]);
  }
  if (syncState === "clean") {
    pushCommand("pull-current", "Refresh from Server", [
      "refresh",
      "pull",
      "reload workspace",
      "server",
    ]);
  }

  // 2. Dock pins, strictly in dock order.
  for (const entityId of workspace.dock.items) {
    const entity = workspace.entities.find((candidate) => candidate.id === entityId);
    if (entity === undefined) {
      continue;
    }
    if (entity.kind === "app") {
      pushApp(entity);
    } else if (entity.kind === "folder") {
      pushFolderById(entity.id);
    }
  }

  // 3. Active-page entities, strictly in layout item order.
  const activePage =
    activePageId !== null
      ? workspace.pages.find((page) => page.id === activePageId)
      : undefined;
  if (activePage !== undefined) {
    for (const item of activePage.layout.items) {
      const entity = workspace.entities.find((candidate) => candidate.id === item.id);
      if (entity === undefined) {
        continue;
      }
      if (entity.kind === "app") {
        pushApp(entity);
      } else if (entity.kind === "folder") {
        pushFolderById(entity.id);
      }
    }
  }

  // 4. Remaining apps/folders, strictly in entity order (widgets excluded).
  for (const entity of workspace.entities) {
    if (entity.kind === "app") {
      pushApp(entity);
    } else if (entity.kind === "folder") {
      pushFolderById(entity.id);
    }
  }

  // 5. Pages, strictly in page order.
  for (const page of workspace.pages) {
    push({
      key: `page:${page.id}`,
      entry: {
        kind: "page",
        key: `page:${page.id}`,
        pageId: page.id,
        label: page.name,
        secondary: ["page", page.id],
        baseOrder: 0,
      },
    });
  }

  return drafts.map((draft) => draft.entry);
}
