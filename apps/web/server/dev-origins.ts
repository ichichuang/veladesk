/**
 * Parses VELADESK_DEV_ALLOWED_ORIGINS into the hostname list consumed by
 * Next.js `allowedDevOrigins` when the dev server is reached over the LAN.
 *
 * The value is a comma-separated list of hostnames. Entries are trimmed,
 * blank entries are dropped, and duplicates are removed keeping the first
 * occurrence. Entries are otherwise kept verbatim: no scheme is added, no
 * port or path is rewritten — the developer stays responsible for matching
 * the hostname contract Next.js documents for dev-origin allowlisting.
 */
export function parseDevAllowedOrigins(
  raw: string | undefined,
): readonly string[] {
  if (raw === undefined) {
    return [];
  }

  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const hostname = entry.trim();
    if (hostname !== "") {
      seen.add(hostname);
    }
  }
  return [...seen];
}
