import type { AppShortcut } from "@veladesk/domain";

import { isParseableAppUrl } from "./app-url-validation";

/**
 * Launches an app shortcut according to its open mode.
 *
 * URLs are opened verbatim — custom protocols (obsidian://, steam://, …)
 * stay valid and are never sanitized to http-only. Browsers may ignore
 * window features; that outcome is accepted by design.
 *
 * Returns whether the launch could even be attempted (UX-04): a stored
 * URL that no longer parses (legacy free-text data) or a popup the
 * browser refused returns `false` so the caller can surface a toast
 * instead of leaving the click silently dead / opening an error page.
 */
export function launchApp(app: AppShortcut): boolean {
  if (!isParseableAppUrl(app.url)) {
    return false;
  }
  switch (app.openMode) {
    case "same-tab":
      window.location.assign(app.url);
      return true;
    case "popup":
      return window.open(app.url, "_blank", "popup=yes,width=1100,height=760") !== null;
    case "new-tab":
    case "new-window":
      return window.open(app.url, "_blank", "noopener,noreferrer") !== null;
  }
}
