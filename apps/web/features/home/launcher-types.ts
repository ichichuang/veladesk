import type { DesktopPageId, EntityId } from "@veladesk/domain";

/**
 * Commands of the V1 workspace launcher.
 *
 * A deliberately closed set: local structure commands (Add App, New
 * Folder, mode toggle) plus exactly one remote command that depends on the
 * working copy's sync state — never both at once.
 */
export type LauncherCommandId =
  | "add-app"
  | "new-folder"
  | "toggle-mode"
  | "sync-current"
  | "pull-current";

/**
 * One searchable launcher entry: pure data, no callbacks.
 *
 * `key` is stable and unique within a workspace (`app:<id>`,
 * `folder:<id>`, `page:<id>`, `command:<command-id>`) and doubles as the
 * React key. `secondary` holds raw extra searchable strings; `baseOrder`
 * is the entry's position in the empty-query discoverability order and
 * the deterministic search tie-break.
 */
export type LauncherEntry =
  | {
      readonly kind: "app";
      readonly key: string;
      readonly entityId: EntityId;
      readonly label: string;
      readonly secondary: readonly string[];
      readonly baseOrder: number;
    }
  | {
      readonly kind: "folder";
      readonly key: string;
      readonly entityId: EntityId;
      readonly label: string;
      readonly secondary: readonly string[];
      readonly baseOrder: number;
    }
  | {
      readonly kind: "page";
      readonly key: string;
      readonly pageId: DesktopPageId;
      readonly label: string;
      readonly secondary: readonly string[];
      readonly baseOrder: number;
    }
  | {
      readonly kind: "command";
      readonly key: string;
      readonly commandId: LauncherCommandId;
      readonly label: string;
      readonly secondary: readonly string[];
      readonly baseOrder: number;
    };
