/**
 * Pure URL normalization for Smart App Recognition (task 020-A §5).
 *
 * ONE normalizer shared by the client form (to decide when a URL is
 * recognizable and to dedupe requests) and the server recognizer (as the
 * validation gate in front of every remote fetch, redirects included).
 *
 * Scope: this normalizes for RECOGNITION only. Persisted app URLs keep
 * VelaDesk's verbatim policy (custom protocols stay valid at creation);
 * only http/https public destinations are recognizable.
 */

import { APP_RECOGNITION_MAX_URL_LENGTH } from "./contract";

export type NormalizeAppUrlFailureReason =
  | "invalid"
  | "unsupported-protocol"
  | "credentials-not-allowed"
  | "unsupported-port"
  | "unsafe-host";

export type NormalizeAppUrlResult =
  | {
      readonly ok: true;
      readonly url: URL;
      readonly normalizedUrl: string;
      readonly hostname: string;
    }
  | {
      readonly ok: false;
      readonly reason: NormalizeAppUrlFailureReason;
    };

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const DOTTED_IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Normalizes a user-entered website address for recognition:
 *
 * - schemeless input defaults to `https://` (protocol-relative `//` too);
 * - only `http:`/`https:` are accepted — `javascript:`, `data:`, `file:`,
 *   `ftp:`, `blob:`, custom app schemes are rejected;
 * - credentials in the URL are rejected;
 * - only the default HTTP(S) ports survive (`URL` already drops `:80`/`:443`,
 *   so any remaining port is non-default and rejected);
 * - literal IP hosts and local/reserved hostnames are rejected — recognition
 *   only targets public websites (adding `localhost` apps manually stays
 *   possible; they are simply never auto-recognized);
 * - hostname case, whitespace and default-port representation are normalized;
 *   path, query and fragment are preserved.
 */
export function normalizeAppRecognitionUrl(input: string): NormalizeAppUrlResult {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > APP_RECOGNITION_MAX_URL_LENGTH) {
    return { ok: false, reason: "invalid" };
  }

  let candidate = trimmed;
  if (!SCHEME_PATTERN.test(trimmed)) {
    // Schemeless host input: default to https. Protocol-relative URLs keep
    // their "//" instead of gaining a broken "https:////".
    candidate = trimmed.startsWith("//") ? `https:${trimmed}` : `https://${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return { ok: false, reason: "unsupported-protocol" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials-not-allowed" };
  }
  // URL drops default ports (80/443); anything left is a service port.
  if (url.port !== "") {
    return { ok: false, reason: "unsupported-port" };
  }
  const hostname = url.hostname;
  if (hostname === "") {
    return { ok: false, reason: "invalid" };
  }
  if (isLiteralIpAddressHost(hostname) || isBlockedLocalHostname(hostname)) {
    return { ok: false, reason: "unsafe-host" };
  }

  return { ok: true, url, normalizedUrl: url.toString(), hostname };
}

/**
 * Whether a (lowercased, bracketed-for-IPv6) URL hostname is a literal IP.
 * WHATWG URL parsing canonicalizes IPv4-ish hosts (hex/octal/single-number),
 * so dotted-decimal detection after parsing covers every IPv4 spelling.
 */
function isLiteralIpAddressHost(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return true;
  }
  return DOTTED_IPV4_PATTERN.test(hostname);
}

/**
 * Local/reserved HOSTNAME policy (IP ranges live in the server's resolved-
 * address checks). Recognition must never target the user's own machine or
 * intranet naming.
 */
export function isBlockedLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") {
    return true;
  }
  const blockedSuffixes = [".localhost", ".local", ".internal", ".home.arpa"];
  if (blockedSuffixes.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  return host === "local" || host === "internal" || host === "home.arpa";
}
