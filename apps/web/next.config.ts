import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// ESM/TS config: derive directories from import.meta.url, never __dirname.
const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "../..");

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
    "@veladesk/desktop-engine",
    "@veladesk/desktop-interaction",
    "@veladesk/domain",
    "@veladesk/database",
  ],
};

export default nextConfig;
