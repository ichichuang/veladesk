import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { parseDevAllowedOrigins } from "./server/dev-origins";

// ESM/TS config: derive directories from import.meta.url, never __dirname.
const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "../..");

// LAN development: comma-separated hostnames allowed to fetch dev-only
// resources (/_next/hmr, /__nextjs_font/*) from the dev server. Only read
// in development; production standalone never touches this env var.
const devAllowedOrigins = parseDevAllowedOrigins(
  process.env.VELADESK_DEV_ALLOWED_ORIGINS,
);

const nextConfig: NextConfig = {
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
