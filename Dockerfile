# VelaDesk production image — Next.js 16 fullstack (frontend + API + SQLite).
#
# Build contract (must stay in sync with apps/web/server/config.ts):
#   - NODE_ENV=production makes the server REQUIRE VELADESK_DATA_DIR and
#     VELADESK_MIGRATIONS_DIR; both are set below and overridable at run time.
#   - The server binds HOSTNAME / PORT (Next convention; no VELADESK_* alias
#     is read by `next start`).
#   - Everything VelaDesk persists lives under VELADESK_DATA_DIR (SQLite
#     database, uploaded assets, engineering credentials) — that directory is
#     the backup boundary and is declared as a VOLUME at /data.
#
# Multi-arch: built and tested on linux/arm64 and linux/amd64. better-sqlite3
# uses a prebuilt binary when one matches; python3/make/g++ are installed in
# the builder stage as the node-gyp fallback so the install never fails.

# ---- build stage -------------------------------------------------------
FROM node:24-bookworm-slim AS build

# Native-module fallback toolchain (better-sqlite3). Prebuilts cover the
# common node/ABI pairs; this only matters when they don't.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@11.17.0

WORKDIR /app

# Install dependencies first so source changes don't invalidate the layer.
# Only the files pnpm needs to resolve the workspace are copied here.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/assets/package.json packages/assets/package.json
COPY packages/canvas-engine/package.json packages/canvas-engine/package.json
COPY packages/client-runtime/package.json packages/client-runtime/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/desktop-engine/package.json packages/desktop-engine/package.json
COPY packages/desktop-interaction/package.json packages/desktop-interaction/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/icon-catalog/package.json packages/icon-catalog/package.json
COPY packages/local-store/package.json packages/local-store/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sync/package.json packages/sync/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

# Full source, then the workspace production build (turbo build).
COPY . .
RUN pnpm build

# ---- runtime stage -----------------------------------------------------
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    VELADESK_DATA_DIR=/data \
    VELADESK_MIGRATIONS_DIR=/app/packages/database/drizzle

# Persistent state: SQLite database, uploaded assets, engineering credentials.
# A named/bound volume mounted here IS the deployment's data boundary.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

WORKDIR /app
COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/workspaces').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run `next start` from apps/web so the server resolves the workspace tree
# exactly like a source deployment does (docs/DEPLOYMENT.md, 方式 B).
WORKDIR /app/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start"]
