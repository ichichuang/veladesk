/**
 * Deterministic brand recognition by hostname (task 020-A §17–§19).
 *
 * Client-safe home of the seed table: pure data + a pure lookup, shared by
 * the server recognizer and (task 024) the offline JSON import icon policy.
 * No server-only imports may appear here — the recognition boundary
 * contracts forbid `features/**` from reaching into `server/`.
 *
 * The seed set is a small, high-quality table of REGISTRABLE DOMAINS mapped
 * to icons that already exist in VelaDesk's bundled `simple-icons`
 * collection — no second icon system. Matching is structural: a hostname
 * matches only when it IS the brand's registrable domain or a dot-separated
 * subdomain of it (`gist.github.com` ✓, `github.example.com` ✗). Because
 * every alias below is a two-label registrable domain (its TLD is a public
 * suffix), label-boundary suffix matching is exactly registrable-domain
 * matching — no PSL library needed for a fixed, curated table. The
 * colocated server test enforces the two-label invariant so the assumption
 * cannot silently rot when aliases are added.
 */

export interface BrandMatch {
  readonly brandId: string;
  readonly displayName: string;
  readonly iconKey: string;
  readonly confidence: "high";
}

interface BrandAlias {
  readonly brandId: string;
  readonly displayName: string;
  readonly iconKey: string;
}

/** hostname (registrable domain) → brand. */
const BRAND_ALIASES: Readonly<Record<string, BrandAlias>> = {
  "github.com": { brandId: "github", displayName: "GitHub", iconKey: "simple-icons:github" },
  "youtube.com": { brandId: "youtube", displayName: "YouTube", iconKey: "simple-icons:youtube" },
  "youtu.be": { brandId: "youtube", displayName: "YouTube", iconKey: "simple-icons:youtube" },
  "notion.so": { brandId: "notion", displayName: "Notion", iconKey: "simple-icons:notion" },
  "figma.com": { brandId: "figma", displayName: "Figma", iconKey: "simple-icons:figma" },
  "discord.com": { brandId: "discord", displayName: "Discord", iconKey: "simple-icons:discord" },
  "reddit.com": { brandId: "reddit", displayName: "Reddit", iconKey: "simple-icons:reddit" },
  "openai.com": { brandId: "openai", displayName: "OpenAI", iconKey: "simple-icons:openai" },
  "gitlab.com": { brandId: "gitlab", displayName: "GitLab", iconKey: "simple-icons:gitlab" },
};

/**
 * Resolves a hostname to a known brand. `gist.github.com`,
 * `www.github.com` and `m.youtube.com` match their brands;
 * `github.example.com` and `notgithub.com` never do.
 */
export function resolveBrandFromHostname(hostname: string): BrandMatch | null {
  let candidate = hostname.trim().toLowerCase().replace(/\.$/, "");
  // Walk up one label at a time: any subdomain of a brand's registrable
  // domain belongs to the brand; nothing else ever matches.
  for (;;) {
    const alias = BRAND_ALIASES[candidate];
    if (alias !== undefined) {
      return { ...alias, confidence: "high" };
    }
    const dot = candidate.indexOf(".");
    if (dot === -1) {
      return null;
    }
    candidate = candidate.slice(dot + 1);
  }
}

/** The seed table, exposed for the structural-invariant test. */
export function brandAliasHostnames(): readonly string[] {
  return Object.keys(BRAND_ALIASES);
}

/** The seed table's icon keys, exposed for the catalog-membership test. */
export function brandAliasIconKeys(): readonly string[] {
  return Object.values(BRAND_ALIASES).map((alias) => alias.iconKey);
}
