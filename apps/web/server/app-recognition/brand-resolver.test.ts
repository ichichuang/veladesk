import { describe, expect, it } from "vitest";

import { loadIconSet } from "@veladesk/icon-catalog";

import {
  brandAliasHostnames,
  brandAliasIconKeys,
  resolveBrandFromHostname,
} from "./brand-resolver";

describe("resolveBrandFromHostname", () => {
  it("recognizes the seed brands exactly", () => {
    expect(resolveBrandFromHostname("github.com")).toMatchObject({
      brandId: "github",
      displayName: "GitHub",
      iconKey: "simple-icons:github",
      confidence: "high",
    });
    expect(resolveBrandFromHostname("youtube.com")).toMatchObject({
      displayName: "YouTube",
      iconKey: "simple-icons:youtube",
    });
    expect(resolveBrandFromHostname("youtu.be")).toMatchObject({
      displayName: "YouTube",
      iconKey: "simple-icons:youtube",
    });
    expect(resolveBrandFromHostname("notion.so")).toMatchObject({ displayName: "Notion" });
    expect(resolveBrandFromHostname("figma.com")).toMatchObject({ displayName: "Figma" });
    expect(resolveBrandFromHostname("discord.com")).toMatchObject({ displayName: "Discord" });
    expect(resolveBrandFromHostname("reddit.com")).toMatchObject({ displayName: "Reddit" });
    expect(resolveBrandFromHostname("openai.com")).toMatchObject({
      displayName: "OpenAI",
      iconKey: "simple-icons:openai",
    });
    expect(resolveBrandFromHostname("gitlab.com")).toMatchObject({ displayName: "GitLab" });
  });

  it("supports meaningful subdomains via registrable-domain matching", () => {
    expect(resolveBrandFromHostname("www.github.com")).toMatchObject({ brandId: "github" });
    expect(resolveBrandFromHostname("gist.github.com")).toMatchObject({ brandId: "github" });
    expect(resolveBrandFromHostname("m.youtube.com")).toMatchObject({ brandId: "youtube" });
    expect(resolveBrandFromHostname("deep.sub.gitlab.com")).toMatchObject({ brandId: "gitlab" });
    expect(resolveBrandFromHostname("GITHUB.COM")).toMatchObject({ brandId: "github" });
  });

  it("never matches on nested suffix strings or unknown hosts", () => {
    expect(resolveBrandFromHostname("github.example.com")).toBeNull();
    expect(resolveBrandFromHostname("notgithub.com")).toBeNull();
    expect(resolveBrandFromHostname("github.com.evil.example")).toBeNull();
    expect(resolveBrandFromHostname("unknown.example")).toBeNull();
    expect(resolveBrandFromHostname("example.com")).toBeNull();
  });
});

describe("brand alias table invariants", () => {
  it("every alias is a two-label registrable domain", () => {
    // Suffix matching is only equivalent to registrable-domain matching
    // while every alias IS a registrable domain (two labels, public-suffix
    // TLD). A three-label entry (e.g. a shared hosting zone like
  // github.io) would make the matcher over-claim and must not be added.
    for (const hostname of brandAliasHostnames()) {
      expect(hostname.split("."), hostname).toHaveLength(2);
      expect(hostname).toBe(hostname.toLowerCase());
    }
  });

  it("every icon key exists in the bundled brand collections", async () => {
    // The bundled brand collections only — the seed table never references
    // a collection outside the catalog.
    const sets = new Map<string, Awaited<ReturnType<typeof loadIconSet>>>();
    for (const iconKey of brandAliasIconKeys()) {
      const separator = iconKey.indexOf(":");
      const collection = iconKey.slice(0, separator);
      const name = iconKey.slice(separator + 1);
      expect(collection === "simple-icons" || collection === "logos", iconKey).toBe(true);
      let set = sets.get(collection);
      if (set === undefined) {
        set = await loadIconSet(collection as "simple-icons" | "logos");
        sets.set(collection, set);
      }
      const present = set.icons[name] !== undefined || set.aliases?.[name] !== undefined;
      expect(present, iconKey).toBe(true);
    }
  });
});
