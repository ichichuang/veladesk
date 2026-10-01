import { describe, expect, it } from "vitest";

import { isBlockedLocalHostname, normalizeAppRecognitionUrl } from "./normalize-url";

/** Narrows a successful result to its normalized URL (fails the test otherwise). */
function okNormalized(input: string): string {
  const result = normalizeAppRecognitionUrl(input);
  if (!result.ok) {
    throw new Error(`expected a normalized result for ${input}`);
  }
  return result.normalizedUrl;
}

describe("normalizeAppRecognitionUrl", () => {
  it("defaults schemeless input to https", () => {
    expect(normalizeAppRecognitionUrl("github.com")).toEqual({
      ok: true,
      url: new URL("https://github.com/"),
      normalizedUrl: "https://github.com/",
      hostname: "github.com",
    });
    expect(okNormalized("www.github.com")).toBe("https://www.github.com/");
  });

  it("keeps protocol-relative input on https", () => {
    expect(okNormalized("//github.com/openai")).toBe("https://github.com/openai");
  });

  it("preserves path, query and fragment", () => {
    const result = normalizeAppRecognitionUrl("https://github.com/openai?tab=repos#stars");
    expect(result).toMatchObject({
      ok: true,
      normalizedUrl: "https://github.com/openai?tab=repos#stars",
    });
  });

  it("supports http", () => {
    expect(okNormalized("http://example.com/path")).toBe("http://example.com/path");
  });

  it("normalizes hostname case and surrounding whitespace", () => {
    const result = normalizeAppRecognitionUrl("  HTTPS://GITHUB.COM  ");
    expect(result).toMatchObject({ ok: true, hostname: "github.com", normalizedUrl: "https://github.com/" });
  });

  it("drops default ports but rejects service ports", () => {
    expect(normalizeAppRecognitionUrl("https://github.com:443/")).toMatchObject({
      ok: true,
      normalizedUrl: "https://github.com/",
    });
    expect(normalizeAppRecognitionUrl("http://example.com:80/")).toMatchObject({
      ok: true,
      normalizedUrl: "http://example.com/",
    });
    expect(normalizeAppRecognitionUrl("https://github.com:8443/")).toEqual({
      ok: false,
      reason: "unsupported-port",
    });
    expect(normalizeAppRecognitionUrl("ssh://git@github.com:22/repo.git")).toEqual({
      ok: false,
      reason: "unsupported-protocol",
    });
  });

  it("rejects unsupported protocols", () => {
    for (const input of [
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "file:///etc/passwd",
      "ftp://example.com/pub",
      "chrome://settings",
      "blob:https://example.com/uuid",
      "obsidian://note",
      "steam://store",
    ]) {
      expect(normalizeAppRecognitionUrl(input)).toEqual({ ok: false, reason: "unsupported-protocol" });
    }
  });

  it("rejects embedded credentials", () => {
    expect(normalizeAppRecognitionUrl("https://user:pass@example.com/")).toEqual({
      ok: false,
      reason: "credentials-not-allowed",
    });
    expect(normalizeAppRecognitionUrl("https://user@example.com/")).toEqual({
      ok: false,
      reason: "credentials-not-allowed",
    });
  });

  it("rejects local and reserved hostnames", () => {
    for (const input of [
      "https://localhost/",
      "http://app.localhost/",
      "https://printer.local/",
      "https://wiki.internal/",
      "https://host.home.arpa/",
    ]) {
      expect(normalizeAppRecognitionUrl(input)).toEqual({ ok: false, reason: "unsafe-host" });
    }
  });

  it("rejects literal IP hosts", () => {
    for (const input of [
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "https://192.168.1.4/",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/",
      // WHATWG canonicalizes these spellings to dotted-quad before the check.
      "http://0x7f000001/",
      "http://2130706433/",
      "http://127.1/",
      "https://[::1]/",
      "https://[fe80::1]/",
      "https://[2606:4700::1111]/",
    ]) {
      expect(normalizeAppRecognitionUrl(input)).toEqual({ ok: false, reason: "unsafe-host" });
    }
  });

  it("rejects invalid syntax", () => {
    for (const input of ["", "   ", "not a url", "https://", "http://a b.com/", "://missing-scheme"]) {
      expect(normalizeAppRecognitionUrl(input)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("enforces the maximum length", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    expect(normalizeAppRecognitionUrl(long)).toEqual({ ok: false, reason: "invalid" });
    const edge = `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`;
    expect(edge.length).toBe(2048);
    expect(normalizeAppRecognitionUrl(edge)).toMatchObject({ ok: true });
  });
});

describe("isBlockedLocalHostname", () => {
  it("blocks local naming forms only", () => {
    expect(isBlockedLocalHostname("localhost")).toBe(true);
    expect(isBlockedLocalHostname("staging.localhost")).toBe(true);
    expect(isBlockedLocalHostname("nas.local")).toBe(true);
    expect(isBlockedLocalHostname("gitlab.internal")).toBe(true);
    expect(isBlockedLocalHostname("router.home.arpa")).toBe(true);
    expect(isBlockedLocalHostname("Local")).toBe(true);
    expect(isBlockedLocalHostname("github.com")).toBe(false);
    expect(isBlockedLocalHostname("mylocalsite.com")).toBe(false);
    expect(isBlockedLocalHostname("internal.example.com")).toBe(false);
  });
});
