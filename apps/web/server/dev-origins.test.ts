import { describe, expect, it } from "vitest";

import { parseDevAllowedOrigins } from "./dev-origins";

describe("parseDevAllowedOrigins: unset and blank input", () => {
  it("returns an empty list for undefined", () => {
    expect(parseDevAllowedOrigins(undefined)).toEqual([]);
  });

  it("returns an empty list for an empty string", () => {
    expect(parseDevAllowedOrigins("")).toEqual([]);
  });

  it("returns an empty list for whitespace-only input", () => {
    expect(parseDevAllowedOrigins("   ")).toEqual([]);
  });

  it("returns an empty list for comma-only input", () => {
    expect(parseDevAllowedOrigins(" , , ")).toEqual([]);
  });
});

describe("parseDevAllowedOrigins: hostname lists", () => {
  it("parses a single hostname", () => {
    expect(parseDevAllowedOrigins("10.100.50.74")).toEqual(["10.100.50.74"]);
  });

  it("parses a comma-separated list", () => {
    expect(parseDevAllowedOrigins("10.100.50.74,veladesk.local")).toEqual([
      "10.100.50.74",
      "veladesk.local",
    ]);
  });

  it("trims whitespace around each entry", () => {
    expect(parseDevAllowedOrigins("  10.100.50.74 ,  veladesk.local  ")).toEqual([
      "10.100.50.74",
      "veladesk.local",
    ]);
  });

  it("drops empty entries between commas", () => {
    expect(parseDevAllowedOrigins("10.100.50.74,,veladesk.local")).toEqual([
      "10.100.50.74",
      "veladesk.local",
    ]);
  });

  it("keeps entries verbatim without adding schemes, ports, or paths", () => {
    expect(parseDevAllowedOrigins("example.test:4321")).toEqual(["example.test:4321"]);
  });
});

describe("parseDevAllowedOrigins: dedupe", () => {
  it("deduplicates repeated hostnames keeping the first occurrence", () => {
    expect(parseDevAllowedOrigins("10.0.0.1, 10.0.0.1")).toEqual(["10.0.0.1"]);
  });

  it("deduplicates across a longer list while preserving first-seen order", () => {
    expect(
      parseDevAllowedOrigins("veladesk.local, 10.0.0.1, veladesk.local, 10.0.0.2, 10.0.0.1"),
    ).toEqual(["veladesk.local", "10.0.0.1", "10.0.0.2"]);
  });

  it("treats entries differing only in surrounding whitespace as duplicates", () => {
    expect(parseDevAllowedOrigins("host.lan,  host.lan  ")).toEqual(["host.lan"]);
  });
});
