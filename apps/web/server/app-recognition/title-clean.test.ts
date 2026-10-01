import { describe, expect, it } from "vitest";

import {
  clampName,
  cleanRecognizedTitle,
  hostnameBrandToken,
  hostnameDisplayName,
} from "./title-clean";

describe("cleanRecognizedTitle", () => {
  it("extracts the brand segment from separator titles", () => {
    expect(
      cleanRecognizedTitle("GitHub · Change is constant. GitHub keeps you ahead.", "github.com")
    ).toBe("GitHub");
    expect(cleanRecognizedTitle("YouTube", "youtube.com")).toBe("YouTube");
    expect(cleanRecognizedTitle("Google Docs — Online Document Editor", "docs.google.com")).toBe(
      "Google Docs"
    );
    expect(cleanRecognizedTitle("Figma | The Collaborative Interface Design Tool", "figma.com")).toBe(
      "Figma"
    );
  });

  it("keeps legitimately hyphenated names", () => {
    // Hyphen inside a segment is never a separator.
    expect(cleanRecognizedTitle("Coca-Cola — Refresh the World", "coca-cola.com")).toBe("Coca-Cola");
    expect(cleanRecognizedTitle("MiX-Master Dashboard", "mixmaster.example")).toBe("MiX-Master Dashboard");
    // A spaced hyphen only splits when the hostname token matches a side.
    expect(cleanRecognizedTitle("iFixit - The Free Repair Manual", "ifixit.com")).toBe("iFixit");
    expect(cleanRecognizedTitle("Some Product - Great Deals Here", "shop.example")).toBe(
      "Some Product - Great Deals Here"
    );
  });

  it("uses the first segment for simple two-part layouts without a token match", () => {
    expect(cleanRecognizedTitle("Proton Mail | Privacy by default")).toBe("Proton Mail");
    // Without a hostname token and a sentence-like first segment, the FULL
    // title is kept — no blind truncation.
    expect(cleanRecognizedTitle("Change is constant. Keep ahead. | GitHub")).toBe(
      "Change is constant. Keep ahead. | GitHub"
    );
  });

  it("collapses whitespace and trims surrounding punctuation", () => {
    expect(cleanRecognizedTitle("  Example   —  Secure   email  ", "example.com")).toBe("Example");
    expect(cleanRecognizedTitle("(Example)", "example.com")).toBe("Example");
    expect(cleanRecognizedTitle("Example —", "example.com")).toBe("Example");
    expect(cleanRecognizedTitle("   ", "example.com")).toBe("");
  });

  it("clamps marketing titles to the app-name budget", () => {
    const long = `${"Word ".repeat(40)}Tail`;
    const cleaned = cleanRecognizedTitle(long, "example.com");
    expect(Array.from(cleaned).length).toBeLessThanOrEqual(80);
  });
});

describe("hostnameBrandToken", () => {
  it("derives the registrable-domain label", () => {
    expect(hostnameBrandToken("github.com")).toBe("github");
    expect(hostnameBrandToken("www.github.com")).toBe("github");
    expect(hostnameBrandToken("docs.google.com")).toBe("google");
    expect(hostnameBrandToken("youtu.be")).toBe("youtu");
    expect(hostnameBrandToken("example.com.")).toBe("example");
    expect(hostnameBrandToken(undefined)).toBeUndefined();
  });
});

describe("hostnameDisplayName", () => {
  it("capitalizes the host token", () => {
    expect(hostnameDisplayName("unknown-site.example")).toBe("Unknown Site");
    expect(hostnameDisplayName("docs.example.co.uk")).toBe("Example");
  });
});

describe("clampName", () => {
  it("keeps short names and clamps long ones by code point", () => {
    expect(clampName("VelaDesk")).toBe("VelaDesk");
    const eightyChars = "a".repeat(80);
    expect(clampName(eightyChars)).toBe(eightyChars);
    expect(clampName(`${eightyChars}extra`)).toBe(eightyChars);
  });
});
