/**
 * The ONE safe remote-fetch boundary (task 020-A §6–§10).
 *
 * Every external recognition fetch — HTML, redirect targets, manifests,
 * icons, favicons — goes through `safeFetchPublicUrl`. No other
 * recognition module may open a remote connection.
 *
 * SSRF posture:
 *  - the URL passes the shared normalizer (protocol/credentials/port/
 *    hostname policy, literal-IP refusal) before ANY connection;
 *  - the hostname is resolved server-side and EVERY resolved address must
 *    be public/global — a mixed public+private answer rejects the host;
 *  - the transport connects to the VALIDATED address (DNS pinning — a
 *    rebinding attack cannot re-resolve between check and connect) while
 *    the Host header and TLS SNI/verification keep using the original
 *    hostname (wired in `node-transport.ts`);
 *  - redirects are followed MANUALLY, at most `RECOGNITION_MAX_REDIRECTS`
 *    hops, and every hop re-runs the full validation chain;
 *  - bodies are size-bounded (the sink aborts as soon as the budget is
 *    exceeded) and the whole operation runs under one deadline;
 *  - no cookies, no VelaDesk credentials, no forwarded headers — a minimal
 *    recognition User-Agent and Accept only.
 *
 * All policy runs against INJECTED `lookupHost`/`transport` seams, so the
 * SSRF behavior is fully covered by unit tests without a network.
 */

import { isPublicHostAddress } from "./public-address";
import { normalizeAppRecognitionUrl } from "../../features/app-recognition/normalize-url";

// --- Bounded budgets (task 020-A §10) ---------------------------------------

export const RECOGNITION_HTML_MAX_BYTES = 1024 * 1024; // ~1 MiB
export const RECOGNITION_MANIFEST_MAX_BYTES = 256 * 1024; // ~256 KiB
export const RECOGNITION_ICON_MAX_BYTES = 512 * 1024; // ~512 KiB
export const RECOGNITION_TOTAL_TIMEOUT_MS = 5000;
export const RECOGNITION_MAX_REDIRECTS = 4;

const RECOGNITION_USER_AGENT =
  "Mozilla/5.0 (compatible; VelaDeskRecognition/1.0; +self-hosted-startpage)";

// --- Transport contract ------------------------------------------------------

export interface SafeTransportRequest {
  /** The fully validated request URL (Host header + TLS SNI source). */
  readonly url: URL;
  /** The validated PUBLIC address the connection must be pinned to. */
  readonly address: string;
  readonly family: 4 | 6;
  readonly headers: Readonly<Record<string, string>>;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export interface SafeTransportResponse {
  readonly status: number;
  /** Lowercased header names; single-value semantics. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type SafeTransportFailure =
  | "timeout"
  | "connection-failed"
  | "body-too-large"
  | "network-error";

export type SafeTransportResult =
  | { readonly ok: true; readonly response: SafeTransportResponse }
  | { readonly ok: false; readonly reason: SafeTransportFailure };

export type SafeTransport = (request: SafeTransportRequest) => Promise<SafeTransportResult>;

export interface SafeFetchIo {
  /** Resolves a hostname to candidate addresses (all families). */
  readonly lookupHost: (hostname: string) => Promise<ReadonlyArray<{ address: string; family: 4 | 6 }>>;
  readonly transport: SafeTransport;
  readonly now?: () => number;
}

// --- Result contract ----------------------------------------------------------

export type SafeFetchFailure =
  | "unsupported-protocol"
  | "credentials-not-allowed"
  | "unsupported-port"
  | "unsafe-host"
  | "invalid-redirect"
  | "dns-failed"
  | "non-public-address"
  | "too-many-redirects"
  | "timeout"
  | "connection-failed"
  | "body-too-large"
  | "network-error";

export interface SafeFetchSuccess {
  readonly status: number;
  /** Raw Content-Type header ("" when absent). */
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly finalUrl: string;
}

export type SafeFetchResult =
  | ({ readonly ok: true } & SafeFetchSuccess)
  | { readonly ok: false; readonly reason: SafeFetchFailure };

export interface SafeFetchOptions {
  readonly maxBytes: number;
  readonly accept: string;
  /** Budget for this operation (the caller carves it out of the total deadline). */
  readonly timeoutMs: number;
}

// --- The boundary --------------------------------------------------------------

/**
 * Fetches a remote document over the SSRF-safe path. `target` must already
 * be normalized (or a URL produced by this layer during a redirect).
 */
export async function safeFetchPublicUrl(
  target: URL | string,
  options: SafeFetchOptions,
  io: SafeFetchIo
): Promise<SafeFetchResult> {
  const now = io.now ?? (() => Date.now());
  const deadline = now() + options.timeoutMs;
  let current: URL = target instanceof URL ? target : new URL(target);

  for (let hop = 0; ; hop += 1) {
    const normalized = normalizeAppRecognitionUrl(current.toString());
    if (!normalized.ok) {
      return { ok: false, reason: mapNormalizeFailure(normalized.reason, hop === 0) };
    }

    let addresses: ReadonlyArray<{ address: string; family: 4 | 6 }>;
    try {
      addresses = await io.lookupHost(normalized.hostname);
    } catch {
      return { ok: false, reason: "dns-failed" };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: "dns-failed" };
    }
    // A mixture of public and private answers rejects the host outright —
    // never pick the public answer and hope.
    for (const entry of addresses) {
      if (!isPublicHostAddress(entry.address)) {
        return { ok: false, reason: "non-public-address" };
      }
    }
    const pinned = addresses[0];
    if (pinned === undefined) {
      return { ok: false, reason: "dns-failed" };
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      return { ok: false, reason: "timeout" };
    }

    let transportResult: SafeTransportResult;
    try {
      transportResult = await io.transport({
        url: normalized.url,
        address: pinned.address,
        family: pinned.family,
        headers: {
          "user-agent": RECOGNITION_USER_AGENT,
          accept: options.accept,
        },
        maxBytes: options.maxBytes,
        timeoutMs: remaining,
      });
    } catch {
      return { ok: false, reason: "network-error" };
    }
    if (!transportResult.ok) {
      return { ok: false, reason: transportResult.reason };
    }

    const { status, headers, body } = transportResult.response;
    const location = headers["location"];
    if (isRedirectStatus(status) && location !== undefined && location !== "") {
      if (hop >= RECOGNITION_MAX_REDIRECTS) {
        return { ok: false, reason: "too-many-redirects" };
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, reason: "invalid-redirect" };
      }
      current = next;
      continue;
    }

    return {
      ok: true,
      status,
      contentType: headers["content-type"] ?? "",
      body,
      finalUrl: current.toString(),
    };
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function mapNormalizeFailure(
  reason: "invalid" | "unsupported-protocol" | "credentials-not-allowed" | "unsupported-port" | "unsafe-host",
  firstHop: boolean
): SafeFetchFailure {
  switch (reason) {
    case "unsupported-protocol":
      return "unsupported-protocol";
    case "credentials-not-allowed":
      return "credentials-not-allowed";
    case "unsupported-port":
      return "unsupported-port";
    case "unsafe-host":
      return "unsafe-host";
    case "invalid":
      // The initial target is always pre-normalized by the recognizer, so a
      // malformed parse here can only come from a redirect Location.
      return firstHop ? "unsafe-host" : "invalid-redirect";
  }
}

// --- Bounded body sink (used by the real node transport) ----------------------

/**
 * Accumulates response chunks under a hard budget. `push` reports overflow
 * the moment the budget is exceeded so the caller can destroy the socket
 * instead of streaming an unbounded body into memory.
 */
export class BoundedBodySink {
  private readonly chunks: Uint8Array[] = [];
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Uint8Array): "ok" | "overflow" {
    this.total += chunk.byteLength;
    if (this.total > this.maxBytes) {
      return "overflow";
    }
    this.chunks.push(chunk);
    return "ok";
  }

  byteLength(): number {
    return this.total;
  }

  toBytes(): Uint8Array {
    let size = 0;
    for (const chunk of this.chunks) {
      size += chunk.byteLength;
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

/** Builds a lowercased single-value header record from a fetch-like Headers. */
export function headerRecordFrom(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}
