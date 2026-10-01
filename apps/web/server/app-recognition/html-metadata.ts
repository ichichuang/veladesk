/**
 * Tolerant HTML metadata extraction (task 020-A §12–§13).
 *
 * Streams the bounded document through `htmlparser2`'s event parser and
 * collects ONLY the recognition-relevant values — no DOM is built, no
 * ad-hoc regex touches the markup, and the HTML itself is never kept or
 * returned. Relative URLs resolve against the FINAL response URL (after
 * redirects); document <base> is deliberately ignored.
 */

import { Parser } from "htmlparser2";

export interface IconLinkCandidate {
  readonly url: string;
  readonly kind: "apple-touch-icon" | "icon";
  /** Raw `sizes` attribute, when present. */
  readonly sizes?: string;
  /** Raw `type` attribute, when present. */
  readonly type?: string;
}

export interface SiteMetadata {
  readonly applicationName?: string;
  readonly ogSiteName?: string;
  readonly title?: string;
  readonly manifestUrl?: string;
  readonly appleTouchIcons: readonly IconLinkCandidate[];
  readonly iconLinks: readonly IconLinkCandidate[];
}

const MAX_ICON_LINKS = 8;
const TITLE_CAPTURE_LIMIT = 512;

/** Extracts recognition metadata from an HTML document. */
export function extractHtmlMetadata(html: string, baseUrl: string): SiteMetadata {
  const applicationName = singleValue();
  const ogSiteName = singleValue();
  const title = singleValue();
  const manifestUrl = singleValue();
  const appleTouchIcons: IconLinkCandidate[] = [];
  const iconLinks: IconLinkCandidate[] = [];
  let inTitle = false;
  let titleText = "";
  let titleClosed = false;

  const parser = new Parser({
    onopentag(name, attribs) {
      const href = attribs["href"];
      if (name === "meta") {
        const metaName = attribs["name"]?.trim().toLowerCase();
        const property = attribs["property"]?.trim().toLowerCase();
        const content = attribs["content"];
        if (typeof content !== "string" || content.trim().length === 0) {
          return;
        }
        if (metaName === "application-name") {
          applicationName.set(content);
        } else if (property === "og:site_name") {
          ogSiteName.set(content);
        }
        return;
      }
      if (name === "link" && typeof href === "string") {
        const sizesAttr = attribs["sizes"];
        const typeAttr = attribs["type"];
        const relTokens = (attribs["rel"] ?? "")
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter((token) => token.length > 0);
        if (relTokens.length === 0) {
          return;
        }
        const resolved = resolveUrl(href, baseUrl);
        if (resolved === undefined) {
          return;
        }
        const candidate = {
          url: resolved,
          kind: "apple-touch-icon" as const,
          ...(sizesAttr !== undefined ? { sizes: sizesAttr } : {}),
          ...(typeAttr !== undefined ? { type: typeAttr } : {}),
        };
        if (relTokens.includes("manifest")) {
          manifestUrl.set(resolved);
        } else if (relTokens.includes("apple-touch-icon")) {
          if (appleTouchIcons.length < MAX_ICON_LINKS) {
            appleTouchIcons.push(candidate);
          }
        } else if (relTokens.includes("icon") && iconLinks.length < MAX_ICON_LINKS) {
          iconLinks.push({ ...candidate, kind: "icon" });
        }
        return;
      }
      if (name === "title" && !titleClosed) {
        inTitle = true;
      }
    },
    ontext(text) {
      if (inTitle && titleText.length < TITLE_CAPTURE_LIMIT) {
        titleText += text;
      }
    },
    onclosetag(name) {
      if (name === "title" && inTitle) {
        inTitle = false;
        titleClosed = true;
        title.set(titleText);
      }
    },
  });
  parser.write(html);
  parser.end();

  const applicationNameValue = applicationName.get();
  const ogSiteNameValue = ogSiteName.get();
  const titleValue = title.get();
  const manifestUrlValue = manifestUrl.get();
  return {
    ...(applicationNameValue !== undefined ? { applicationName: applicationNameValue } : {}),
    ...(ogSiteNameValue !== undefined ? { ogSiteName: ogSiteNameValue } : {}),
    ...(titleValue !== undefined ? { title: titleValue } : {}),
    ...(manifestUrlValue !== undefined ? { manifestUrl: manifestUrlValue } : {}),
    appleTouchIcons,
    iconLinks,
  };
}

function resolveUrl(href: string, baseUrl: string): string | undefined {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/** First-occurrence-wins cell (deterministic under repeated tags). */
function singleValue() {
  let value: string | undefined;
  return {
    set(next: string) {
      if (value === undefined) {
        value = next;
      }
    },
    get(): string | undefined {
      return value;
    },
  };
}

/** Whether a Content-Type header is acceptable HTML. */
export function isHtmlContentType(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "text/html" || base === "application/xhtml+xml";
}

/**
 * A missing Content-Type is tolerated only when the body clearly looks
 * like HTML (doctype/html opening) — conservative sniff, still bounded by
 * the fetch size limit.
 */
export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 512).trim().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<?xml");
}
