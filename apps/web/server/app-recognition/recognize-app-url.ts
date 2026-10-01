/**
 * The recognition orchestrator (task 020-A Phase C).
 *
 * Combines brand resolution, safe HTML/manifest fetching, metadata
 * extraction and icon-byte validation into ONE deterministic result.
 *
 * Behavior contract:
 *  - a known brand short-circuits with a catalog icon and NEVER touches
 *    the network (§19–§20: a catalog match is never downgraded to a
 *    favicon);
 *  - a valid but unreachable/uncooperative site degrades to a PARTIAL
 *    result (hostname-derived name, generated icon) instead of an error —
 *    hard failures exist only for invalid/unsafe input (§23);
 *  - every remote hop (page, manifest, each icon candidate) goes through
 *    `safeFetchPublicUrl`, so metadata-declared URLs pointing at
 *    localhost/private space are rejected by the same boundary;
 *  - embedded icon bytes must pass the ASSET pipeline's magic-byte gate
 *    (PNG/JPEG/WebP/AVIF) — ICO/SVG remote candidates are skipped, never
 *    ingested;
 *  - the whole operation runs under one `RECOGNITION_TOTAL_TIMEOUT_MS`
 *    deadline.
 */

import { detectUploadedImageMediaType } from "@veladesk/assets/core";

import type {
  AppRecognitionResult,
  RecognitionIcon,
  RecognitionNameSource,
} from "../../features/app-recognition/contract";
import { normalizeAppRecognitionUrl } from "../../features/app-recognition/normalize-url";
import type { NormalizeAppUrlFailureReason } from "../../features/app-recognition/normalize-url";
import { resolveBrandFromHostname } from "./brand-resolver";
import {
  extractHtmlMetadata,
  isHtmlContentType,
  looksLikeHtml,
  type SiteMetadata,
} from "./html-metadata";
import { isManifestContentType, parseWebManifest, declaredSizeFrom } from "./manifest";
import { nodeLookupHost, nodeTransport } from "./node-transport";
import {
  RECOGNITION_HTML_MAX_BYTES,
  RECOGNITION_ICON_MAX_BYTES,
  RECOGNITION_MANIFEST_MAX_BYTES,
  RECOGNITION_TOTAL_TIMEOUT_MS,
  safeFetchPublicUrl,
  type SafeFetchIo,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "./safe-public-fetch";
import {
  cleanRecognizedName,
  cleanRecognizedTitle,
  hostnameDisplayName,
} from "./title-clean";

export type RecognizeAppUrlResult =
  | { readonly ok: true; readonly recognition: AppRecognitionResult }
  | { readonly ok: false; readonly reason: NormalizeAppUrlFailureReason };

/** The production I/O: real DNS + the pinned node transport. */
export function defaultRecognizerIo(): SafeFetchIo {
  return { lookupHost: nodeLookupHost, transport: nodeTransport };
}

const HTML_ACCEPT = "text/html,application/xhtml+xml";
const MANIFEST_ACCEPT = "application/manifest+json,application/json;q=0.9";
const ICON_ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/*;q=0.8,*/*;q=0.5";
const MAX_ICON_ATTEMPTS = 4;

interface IconCandidate {
  readonly url: string;
  readonly source: "manifest" | "apple-touch-icon" | "favicon";
  readonly declaredSize?: number;
}

/**
 * Recognizes a website for the Add-App flow. Network failures NEVER throw
 * and never fail the request — they degrade the result.
 */
export async function recognizeAppUrl(
  input: string,
  ioOverride?: Partial<SafeFetchIo>
): Promise<RecognizeAppUrlResult> {
  const io: SafeFetchIo = { ...defaultRecognizerIo(), ...ioOverride };
  const now = io.now ?? (() => Date.now());
  const deadline = now() + RECOGNITION_TOTAL_TIMEOUT_MS;
  const remaining = () => deadline - now();

  const normalized = normalizeAppRecognitionUrl(input);
  if (!normalized.ok) {
    return { ok: false, reason: normalized.reason };
  }
  const { normalizedUrl, hostname } = normalized;

  // Fast path: exact known brand, zero network (§19).
  const brand = resolveBrandFromHostname(hostname);
  if (brand !== null) {
    return {
      ok: true,
      recognition: {
        normalizedUrl,
        hostname,
        name: brand.displayName,
        nameSource: "brand",
        icon: {
          kind: "catalog",
          iconKey: brand.iconKey,
          displayName: brand.displayName,
          source: "brand",
        },
        confidence: "high",
        status: "recognized",
      },
    };
  }

  const fetch = async (url: string | URL, options: Omit<SafeFetchOptions, "timeoutMs">) =>
    safeFetchPublicUrl(url, { ...options, timeoutMs: Math.max(remaining(), 1) }, io);

  // --- 1) HTML ---------------------------------------------------------------
  let metadata: SiteMetadata | null = null;
  const html = await fetch(normalized.url, { maxBytes: RECOGNITION_HTML_MAX_BYTES, accept: HTML_ACCEPT });
  if (html.ok && html.status >= 200 && html.status < 300) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(html.body);
    if (isHtmlContentType(html.contentType) || (html.contentType === "" && looksLikeHtml(text))) {
      metadata = extractHtmlMetadata(text, html.finalUrl);
    }
  }

  // --- 2) Manifest -------------------------------------------------------------
  let manifest: ReturnType<typeof parseWebManifest> = undefined;
  const manifestUrl = metadata?.manifestUrl;
  if (manifestUrl !== undefined) {
    const fetched = await fetch(manifestUrl, {
      maxBytes: RECOGNITION_MANIFEST_MAX_BYTES,
      accept: MANIFEST_ACCEPT,
    });
    if (
      fetched.ok &&
      fetched.status >= 200 &&
      fetched.status < 300 &&
      (isManifestContentType(fetched.contentType) || fetched.contentType === "")
    ) {
      manifest = parseWebManifest(
        new TextDecoder("utf-8", { fatal: false }).decode(fetched.body),
        fetched.finalUrl
      );
    }
  }

  // --- 3) Name (§15 priority) ---------------------------------------------------
  const name = pickRecognizedName(metadata, manifest, hostname);

  // --- 4) Icon (§20 priority) ---------------------------------------------------
  const icon = await resolveIcon(fetch, metadata, manifest, normalizedUrl);

  // --- 5) Confidence / status ----------------------------------------------------
  const metadataBackedName = name.source !== "hostname";
  const embeddedIcon = icon.kind === "embedded-image";
  const confidence = metadataBackedName && embeddedIcon ? "medium" : "low";
  const status = confidence === "medium" ? "recognized" : "partial";

  return {
    ok: true,
    recognition: {
      normalizedUrl,
      hostname,
      name: name.value,
      nameSource: name.source,
      icon,
      confidence,
      status,
    },
  };
}

interface RecognizedName {
  readonly value: string;
  readonly source: RecognitionNameSource;
}

function pickRecognizedName(
  metadata: SiteMetadata | null,
  manifest: ReturnType<typeof parseWebManifest>,
  hostname: string
): RecognizedName {
  const candidates: ReadonlyArray<{ value: string | undefined; source: RecognitionNameSource }> = [
    { value: metadata?.applicationName !== undefined ? cleanRecognizedName(metadata.applicationName) : undefined, source: "application-name" },
    { value: metadata?.ogSiteName !== undefined ? cleanRecognizedName(metadata.ogSiteName) : undefined, source: "og-site-name" },
    { value: manifest?.shortName, source: "manifest-short-name" },
    { value: manifest?.name, source: "manifest-name" },
    {
      value:
        metadata?.title !== undefined && cleanRecognizedTitle(metadata.title, hostname).length > 0
          ? cleanRecognizedTitle(metadata.title, hostname)
          : undefined,
      source: "title",
    },
  ];
  for (const candidate of candidates) {
    if (candidate.value !== undefined && candidate.value.length > 0) {
      return { value: candidate.value, source: candidate.source };
    }
  }
  return { value: hostnameDisplayName(hostname), source: "hostname" };
}

async function resolveIcon(
  fetch: (url: string | URL, options: Omit<SafeFetchOptions, "timeoutMs">) => Promise<SafeFetchResult>,
  metadata: SiteMetadata | null,
  manifest: ReturnType<typeof parseWebManifest>,
  pageUrl: string
): Promise<RecognitionIcon> {
  const candidates: IconCandidate[] = [];
  for (const icon of manifest?.icons ?? []) {
    candidates.push({ url: icon.url, source: "manifest", ...(icon.declaredSize !== undefined ? { declaredSize: icon.declaredSize } : {}) });
  }
  for (const icon of rankLinkIcons(metadata?.appleTouchIcons ?? [])) {
    candidates.push(icon);
  }
  for (const icon of rankLinkIcons(metadata?.iconLinks ?? [])) {
    candidates.push({ ...icon, source: "favicon" });
  }
  // The conventional root fallback, always last (§20).
  candidates.push({ url: new URL("/favicon.ico", pageUrl).toString(), source: "favicon" });

  let attempts = 0;
  for (const candidate of candidates) {
    if (attempts >= MAX_ICON_ATTEMPTS) {
      break;
    }
    attempts += 1;
    const fetched = await fetch(candidate.url, {
      maxBytes: RECOGNITION_ICON_MAX_BYTES,
      accept: ICON_ACCEPT,
    });
    if (!fetched.ok || fetched.status < 200 || fetched.status >= 300) {
      continue;
    }
    const mediaType = detectUploadedImageMediaType(fetched.body);
    if (mediaType === undefined) {
      continue; // ICO/SVG/unknown bytes are skipped, not ingested.
    }
    return {
      kind: "embedded-image",
      mimeType: mediaType,
      base64: Buffer.from(fetched.body).toString("base64"),
      source: candidate.source,
    };
  }
  return { kind: "generated", source: "generated" };
}

/**
 * Ranks <link> icon candidates: SVG declared/extension candidates are
 * dropped entirely, larger declared sizes first, ties keep document order.
 */
function rankLinkIcons(
  icons: ReadonlyArray<{ url: string; sizes?: string; type?: string }>
): IconCandidate[] {
  return icons
    .filter((icon) => !isSvgIconCandidate(icon))
    .map((icon) => {
      const declaredSize = declaredSizeFrom(icon.sizes);
      return {
        url: icon.url,
        source: "apple-touch-icon" as const,
        ...(declaredSize !== undefined ? { declaredSize } : {}),
      };
    })
    .sort((a, b) => (b.declaredSize ?? 0) - (a.declaredSize ?? 0));
}

function isSvgIconCandidate(icon: { url: string; type?: string }): boolean {
  const declaredType = icon.type?.trim().toLowerCase() ?? "";
  if (declaredType.includes("svg")) {
    return true;
  }
  try {
    const path = new URL(icon.url).pathname.toLowerCase();
    return path.endsWith(".svg");
  } catch {
    return false;
  }
}
