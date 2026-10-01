import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { parseDevAllowedOrigins } from "./server/dev-origins";

// ESM/TS config: derive directories from import.meta.url, never __dirname.
const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "../..");

// The ONE VelaDesk version source is the ROOT package.json. The web build
// derives its client-visible version from it and from nothing else: the
// value below unconditionally overrides any NEXT_PUBLIC_VELADESK_VERSION
// coming from the environment (task 025 §10) — an externally exported
// 9.9.9 can never masquerade as the product version.
const veladeskVersion = (() => {
  const rootManifest = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as { version?: string };
  if (typeof rootManifest.version !== "string" || rootManifest.version.length === 0) {
    throw new Error("root package.json has no version; it is the single VelaDesk version source");
  }
  return rootManifest.version;
})();

// LAN development: comma-separated hostnames allowed to fetch dev-only
// resources (/_next/hmr, /__nextjs_font/*) from the dev server. Only read
// in development; production standalone never touches this env var.
const devAllowedOrigins = parseDevAllowedOrigins(
  process.env.VELADESK_DEV_ALLOWED_ORIGINS,
);

const nextConfig: NextConfig = {
  // The product version shown in Settings and shipped to the browser —
  // derived from the root manifest at build time (see above).
  env: {
    NEXT_PUBLIC_VELADESK_VERSION: veladeskVersion,
  },
  output: "standalone",
  // Trace from the monorepo root so workspace packages and the database
  // migration SQL assets land in the standalone bundle.
  outputFileTracingRoot: repoRoot,
  // The migration folder is a runtime fs resource read via a dynamic
  // migrationsFolder argument, so automatic tracing cannot see it — include
  // it narrowly for the API routes that need it.
  outputFileTracingIncludes: {
    "/api/v1/**": ["../../packages/database/drizzle/**/*"],
  },
  transpilePackages: [
    "@veladesk/canvas-engine",
    "@veladesk/client-runtime",
    "@veladesk/database",
    "@veladesk/desktop-engine",
    "@veladesk/desktop-interaction",
    "@veladesk/domain",
    // The picker and icon renderer import the browser-safe `/meta` subpath
    // (collection ids, palette, category) — never the loaders.
    "@veladesk/icon-catalog",
    "@veladesk/local-store",
    "@veladesk/sync",
  ],
  // Only surface the dev-origin allowlist in development and only when the
  // operator actually configured hostnames, so production builds (and dev
  // without LAN access) see an unchanged config shape.
  ...(process.env.NODE_ENV === "development" && devAllowedOrigins.length > 0
    ? { allowedDevOrigins: [...devAllowedOrigins] }
    : {}),
};

export default nextConfig;
