/**
 * URL field validation for the Add/Edit App dialogs (UX-04).
 *
 * The persistence policy in one pure module, shared by both dialogs so the
 * two forms can never drift:
 *
 *  - Input that already carries a scheme (https:, http:, obsidian:, …) is
 *    accepted verbatim when it parses as a URL — the long-standing custom
 *    protocol policy is untouched.
 *  - Schemeless input is auto-completed to `https://` ONLY when it looks
 *    like a real web destination: a dotted hostname (example.com), an IP
 *    literal, or localhost — each optionally with a port, path, query or
 *    fragment.
 *  - Anything else (free text like `not-a-url`, Chinese prose) is refused
 *    with `invalid` so the dialog can block submission and show an inline
 *    error — previously such input was silently stored, and Chinese text
 *    was even punycoded into a bogus domain by the URL constructor.
 */

/*
 * A scheme prefix for the verbatim arm. Dots are deliberately EXCLUDED:
 * the URL grammar would happily parse `example.com:8080` as scheme
 * "example.com", but a scheme containing a dot is never a real protocol —
 * such input belongs to the host[:port] arm below. `localhost:3000` needs
 * the same escape (a valid scheme NAME, but always meant as a host).
 */
const SCHEME_PATTERN = /^[a-z][a-z0-9+-]*:/i;
const LOCALHOST_SCHEME_PATTERN = /^localhost:\d+([/?#]|$)/i;
const DOTTED_IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;
/** ASCII hostname labels (no IDN — non-ASCII hosts are refused, not punycoded). */
const DOTTED_HOSTNAME_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export type AppUrlValidation =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: "empty" | "invalid" };

/** Splits schemeless input at the first path/query/fragment separator. */
function authorityOf(trimmed: string): string {
  const cut = trimmed.search(/[/?#]/);
  return cut === -1 ? trimmed : trimmed.slice(0, cut);
}

/** The host part of an authority (credentials rejected, port stripped). */
function hostOf(authority: string): string | null {
  if (authority.includes("@")) {
    return null;
  }
  const colon = authority.lastIndexOf(":");
  const host = colon === -1 ? authority : authority.slice(0, colon);
  if (host.startsWith("[")) {
    return host.endsWith("]") ? host : null;
  }
  return host;
}

/** Whether a schemeless host is a plausible web destination (UX-04). */
export function looksLikeWebHost(host: string): boolean {
  if (host === "" || host.includes(" ")) {
    return false;
  }
  if (/^localhost$/i.test(host)) {
    return true;
  }
  if (host.startsWith("[")) {
    // IPv6 literal (bracketed; the URL constructor requires brackets too).
    return host.endsWith("]");
  }
  if (DOTTED_IPV4_PATTERN.test(host)) {
    return true;
  }
  return DOTTED_HOSTNAME_PATTERN.test(host);
}

/**
 * Validates (and normalizes) one dialog URL submission. The returned
 * `url` is what persists: verbatim for scheme'd input, canonical
 * `https://…` (via the URL constructor) for schemeless web-looking input.
 */
export function validateAppUrlInput(input: string): AppUrlValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }

  if (SCHEME_PATTERN.test(trimmed) && !LOCALHOST_SCHEME_PATTERN.test(trimmed)) {
    try {
      new URL(trimmed);
      return { ok: true, url: trimmed };
    } catch {
      return { ok: false, reason: "invalid" };
    }
  }

  const host = hostOf(authorityOf(trimmed));
  if (host === null || !looksLikeWebHost(host)) {
    return { ok: false, reason: "invalid" };
  }
  try {
    return { ok: true, url: new URL(`https://${trimmed}`).toString() };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Whether a STORED url is still openable at all (UX-04's legacy-data arm):
 * snapshots written before validation may carry free text, which the launch
 * path refuses with a toast instead of a browser error page.
 */
export function isParseableAppUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
