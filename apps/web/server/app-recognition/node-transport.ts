/**
 * The real Node transport behind `safeFetchPublicUrl` — the ONLY place in
 * recognition that opens sockets.
 *
 * DNS pinning (task 020-A §8): the request is issued with the ORIGINAL
 * URL (so the Host header and TLS SNI/certificate validation keep using
 * the real hostname — TLS verification stays fully ON) but a custom
 * `lookup` that answers with the already-validated public address. The
 * HTTP connection therefore cannot be re-resolved to a different
 * (rebinding) address between the SSRF check and the connect.
 *
 * Bodies stream through `BoundedBodySink` (aborts the moment the budget
 * is exceeded); redirects are not followed here — `safeFetchPublicUrl`
 * owns that policy and only needs the Location header, so 3xx responses
 * close without buffering a body.
 */

import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";

import {
  BoundedBodySink,
  type SafeTransport,
  type SafeTransportFailure,
  type SafeTransportRequest,
  type SafeTransportResult,
} from "./safe-public-fetch";

/** Server-side hostname resolution (all families, OS resolver order). */
export async function nodeLookupHost(
  hostname: string
): Promise<ReadonlyArray<{ address: string; family: 4 | 6 }>> {
  const addresses: LookupAddress[] = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));
}

export const nodeTransport: SafeTransport = (request: SafeTransportRequest) =>
  new Promise<SafeTransportResult>((resolve) => {
    const url = request.url;
    const sink = new BoundedBodySink(request.maxBytes);
    let settled = false;
    let failure: SafeTransportFailure | undefined;

    const finish = (result: SafeTransportResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const failWith = (reason: SafeTransportFailure) => {
      failure = reason;
      request_.destroy();
      finish({ ok: false, reason });
    };

    const request_ = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET",
      headers: { ...request.headers },
      // PIN the connection to the validated address; hostname/SNI keep
      // driving the Host header and certificate validation.
      lookup: (hostname, options, callback) => {
        void hostname;
        void options;
        callback(null, [{ address: request.address, family: request.family }]);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const headers = flattenHeaders(response.headers);

      if (status >= 300 && status < 400) {
        // Only Location matters; drop the connection without buffering.
        request_.destroy();
        finish({
          ok: true,
          response: { status, headers, body: new Uint8Array(0) },
        });
        return;
      }

      response.on("data", (chunk: Buffer) => {
        if (sink.push(chunk) === "overflow") {
          failWith("body-too-large");
          return;
        }
      });
      response.on("end", () => {
        finish({
          ok: true,
          response: { status, headers, body: sink.toBytes() },
        });
      });
      response.on("error", () => {
        finish({ ok: false, reason: failure ?? "network-error" });
      });
    });

    request_.setTimeout(request.timeoutMs, () => {
      failWith("timeout");
    });
    request_.on("error", () => {
      finish({ ok: false, reason: failure ?? "network-error" });
    });
    request_.end();
  });

function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    record[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return record;
}
