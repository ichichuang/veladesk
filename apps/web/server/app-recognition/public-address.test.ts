import { describe, expect, it } from "vitest";

import { isPublicHostAddress, parseHostAddress, parseIpv6 } from "./public-address";

describe("IPv4 classification", () => {
  it("rejects private and reserved ranges", () => {
    for (const address of [
      "0.0.0.1", // 0.0.0.0/8
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1", // CGNAT
      "100.127.255.254",
      "127.0.0.1",
      "127.255.255.255",
      "169.254.169.254", // cloud metadata
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.10", // documentation
      "192.168.1.4",
      "192.168.0.0",
      "198.18.0.5", // benchmarking
      "198.19.255.1",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1", // multicast
      "239.255.255.250",
      "240.0.0.1", // reserved
      "255.255.255.255",
    ]) {
      expect(isPublicHostAddress(address), address).toBe(false);
    }
  });

  it("accepts known public addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "140.82.112.4", "172.32.0.1", "192.5.5.5", "203.0.114.1"]) {
      expect(isPublicHostAddress(address), address).toBe(true);
    }
  });
});

describe("IPv6 classification", () => {
  it("rejects non-global ranges", () => {
    for (const address of [
      "::", // unspecified (::/128 inside ::/8)
      "::1", // loopback
      "::2", // IETF reserved
      "64:ff9b::127.0.0.1", // NAT64 wrapping loopback
      "100::1", // discard-only
      "2001:db8::1", // documentation
      "fc00::1", // ULA
      "fd12:3456:789a::1",
      "fe80::1", // link-local
      "febf::1",
      "ff02::1", // multicast
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:192.168.1.4", // IPv4-mapped private
      "::ffff:10.0.0.1",
      "2002:7f00:1::", // 6to4 wrapping 127.0.0.1
    ]) {
      expect(isPublicHostAddress(address), address).toBe(false);
    }
  });

  it("accepts known public addresses", () => {
    for (const address of [
      "2606:4700:4700::1111", // Cloudflare DNS
      "2606:4700::6810:85e5",
      "2a00:1450:4001:81b::2004", // Google
      "2620:fe::fe", // Quad9
      "::ffff:8.8.8.8", // IPv4-mapped PUBLIC is public
      "64:ff9b::8.8.8.8", // NAT64 wrapping a public IPv4 is public
    ]) {
      expect(isPublicHostAddress(address), address).toBe(true);
    }
  });
});

describe("parseIpv6", () => {
  it("parses compression and full forms", () => {
    expect(parseIpv6("::")).toBe(0n);
    expect(parseIpv6("::1")).toBe(1n);
    expect(parseIpv6("1::")).toBe(1n << 112n);
    expect(parseIpv6("2001:db8::1")).toBe((0x20010db8n << 96n) | 1n);
    expect(parseIpv6("1:2:3:4:5:6:7:8")).toBe(0x00010002000300040005000600070008n);
    expect(parseIpv6("::ffff:192.168.0.1")).toBe(0x0000ffffc0a80001n);
    expect(parseIpv6("::ffff:c0a8:1")).toBe(0x0000ffffc0a80001n);
  });

  it("rejects malformed addresses", () => {
    for (const address of [
      "1:2:3:4:5:6:7:8:9",
      "1:2:3:4:5:6:7",
      "1:::2",
      "12345::",
      "gggg::",
      "1.2.3.4.5",
      "192.168.0.256",
      "999.1.1.1",
    ]) {
      expect(parseIpv6(address), address).toBeUndefined();
    }
  });
});

describe("parseHostAddress", () => {
  it("detects families and rejects names", () => {
    expect(parseHostAddress("192.0.2.1")).toEqual({ family: 4, address: "192.0.2.1" });
    expect(parseHostAddress("2606:4700::1111")).toEqual({ family: 6, address: "2606:4700::1111" });
    expect(parseHostAddress("example.com")).toBeUndefined();
    expect(isPublicHostAddress("example.com")).toBe(false);
  });
});
