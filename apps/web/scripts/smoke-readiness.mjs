/**
 * Testable readiness/log-capture seams for the standalone smoke script
 * (task 027-R1).
 *
 * The first 1.0.0 release run failed ONLY on windows-latest with
 * "server did not become ready: fetch failed" — and nothing else. Two
 * hypotheses (slow startup vs. an exited process) could not be
 * distinguished because the script (a) snapshotted stderr into a stale
 * empty string at spawn time and (b) reduced every fetch error to its
 * top-level message. These helpers exist so the NEXT run answers that
 * question in its failure output alone, and so the behavior is unit-tested
 * without ever spawning a server locally.
 *
 * Everything here is dependency-injectable: fake child handles, fake
 * fetch, fake clock and sleep. `smoke-standalone.mjs` wires the real ones.
 */

/** Per-stream retained output bound: the collector keeps the LAST bytes. */
export const SERVER_LOG_LIMIT_BYTES = 128 * 1024;

/** Per-stream tail printed in a diagnostic block (GitHub annotations stay readable). */
export const DIAGNOSTIC_TAIL_BYTES = 4 * 1024;

/**
 * Bounded collector over a child process's piped stdio. Chunks append to a
 * live buffer — readers always see the CURRENT content (the regression
 * this replaces stored the string value once at spawn, so later stderr was
 * silently lost). Storage is capped: once the limit is exceeded the OLDEST
 * bytes are dropped and a truncation marker prefixes the stream.
 *
 * @param {import("node:child_process").ChildProcess} child
 */
export function createServerLogCollector(child) {
  const streams = [
    { source: child.stdout, chunks: [], bytes: 0, truncated: 0 },
    { source: child.stderr, chunks: [], bytes: 0, truncated: 0 },
  ];
  for (const stream of streams) {
    stream.source?.on("data", (chunk) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      stream.chunks.push(text);
      stream.bytes += Buffer.byteLength(text);
      while (stream.bytes > SERVER_LOG_LIMIT_BYTES && stream.chunks.length > 1) {
        const dropped = stream.chunks.shift();
        stream.bytes -= Buffer.byteLength(dropped);
        stream.truncated += Buffer.byteLength(dropped);
      }
    });
  }
  const read = (stream) => {
    const prefix = stream.truncated > 0 ? `…(+${stream.truncated} earlier bytes truncated)\n` : "";
    return prefix + stream.chunks.join("");
  };
  return {
    readStdout() {
      return read(streams[0]);
    },
    readStderr() {
      return read(streams[1]);
    },
  };
}

/**
 * A pollable server handle: dynamic exit state plus the live log readers.
 * The getters delegate to the child on every read, so a process that dies
 * mid-poll is observed immediately.
 */
export function createServerHandle(child) {
  const collector = createServerLogCollector(child);
  return {
    child,
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
    readStdout: collector.readStdout,
    readStderr: collector.readStderr,
  };
}

/**
 * Flattens a fetch failure into one line: the top message plus the useful
 * cause fields (never stringifies whole error objects).
 *
 * @param {unknown} error
 */
export function formatFetchCause(error) {
  const parts = [];
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message) {
    parts.push(`message: ${message}`);
  }
  const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
  if (cause && typeof cause === "object") {
    for (const key of ["message", "code", "errno", "syscall", "address", "port"]) {
      const value = cause[key];
      if (value !== undefined && value !== null) {
        parts.push(`cause.${key}: ${value}`);
      }
    }
  }
  return parts.join(", ");
}

/** The last `bytes` of a captured stream, with a marker when it was cut. */
function tail(text, bytes) {
  if (Buffer.byteLength(text) <= bytes) {
    return text;
  }
  return `…(last ${bytes} bytes)\n${Buffer.from(text).subarray(-bytes).toString()}`;
}

/**
 * The diagnostic block attached to every readiness failure: process state,
 * the latest connection cause, and bounded stdio tails.
 */
export function describeServerFailure(server, details = {}) {
  const lines = [
    `child exitCode: ${server.exitCode === null ? "null (still running)" : server.exitCode}`,
    `child signalCode: ${server.signalCode === null ? "null" : server.signalCode}`,
  ];
  for (const [label, value] of Object.entries(details)) {
    if (value !== undefined && value !== null) {
      lines.push(`${label}: ${value}`);
    }
  }
  return [
    lines.join("\n"),
    `--- stdout tail ---\n${tail(server.readStdout(), DIAGNOSTIC_TAIL_BYTES) || "(empty)"}`,
    `--- stderr tail ---\n${tail(server.readStderr(), DIAGNOSTIC_TAIL_BYTES) || "(empty)"}`,
  ].join("\n");
}

/**
 * Polls the readiness URL until it answers 2xx, the deadline passes, or —
 * first of all — the server process is observed to have exited. Early
 * exit fails IMMEDIATELY with the captured output; a timeout reports the
 * process state, the latest connection cause and the environment, so a
 * crashed server and a slow server are distinguishable from the log alone.
 *
 * @param {object} input
 * @param {string} input.url
 * @param {number} input.deadlineMs
 * @param {{ exitCode: number | null, signalCode: string | null, readStdout(): string, readStderr(): string }} input.server
 * @param {(url: string) => Promise<Response>} [input.fetchImpl]
 * @param {(ms: number) => Promise<void>} [input.sleep]
 * @param {() => number} [input.now]
 * @param {Record<string, string | undefined>} [input.diagnostics]
 * @param {number} [input.pollIntervalMs]
 * @returns {Promise<Response>}
 */
export async function pollUntilReady(input) {
  const {
    url,
    deadlineMs,
    server,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    diagnostics = {},
    pollIntervalMs = 250,
  } = input;
  const deadline = now() + deadlineMs;
  let latestCause = "";
  while (now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        [
          `standalone server exited before readiness (exitCode: ${server.exitCode}, signal: ${server.signalCode})`,
          describeServerFailure(server, diagnostics),
        ].join("\n"),
      );
    }
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        return response;
      }
      latestCause = `readiness probe status ${response.status}`;
    } catch (error) {
      latestCause = formatFetchCause(error) || "unknown error";
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    [
      `server did not become ready within ${deadlineMs}ms (url: ${url})`,
      `platform: ${process.platform}, arch: ${process.arch}, node: ${process.version}`,
      describeServerFailure(server, { ...diagnostics, latestFetchCause: latestCause || "none recorded" }),
    ].join("\n"),
  );
}
