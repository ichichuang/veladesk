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

  it("every icon key exists in the bundled simple-icons collection", async () => {
    const iconSet = await loadIconSet("simple-icons");
    for (const iconKey of brandAliasIconKeys()) {
      const name = iconKey.slice("simple-icons:".length);
      const present = iconSet.icons[name] !== undefined || iconSet.aliases?.[name] !== undefined;
      expect(present, iconKey).toBe(true);
    }
  });
});
