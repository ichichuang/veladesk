import type { AppShortcut } from "@veladesk/domain";

/**
 * Launches an app shortcut according to its open mode.
 *
 * URLs are opened verbatim — custom protocols (obsidian://, steam://, …)
 * stay valid and are never sanitized to http-only. Browsers may ignore
 * window features; that outcome is accepted by design.
 */
export function launchApp(app: AppShortcut): void {
  switch (app.openMode) {
    case "same-tab":
      window.location.assign(app.url);
      return;
    case "popup":
      window.open(app.url, "_blank", "popup=yes,width=1100,height=760");
      return;
    case "new-tab":
    case "new-window":
      window.open(app.url, "_blank", "noopener,noreferrer");
      return;
  }
}
