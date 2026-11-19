# AGENTS.md — operational context for AI agents

VelaDesk is a self-hosted browser start page / web desktop (Chinese-first UI,
English switchable in Settings). **One Next.js 16 process serves everything**:
frontend, REST API (`/api/v1/*`), and persistence (SQLite via better-sqlite3,
Drizzle migrations, uploaded image assets on local disk). There is no separate
backend, no external database, and no message queue.

## Deploy contract (the facts that decide success)

- **Not serverless-compatible.** State lives in local files: SQLite DB,
  uploaded assets, engineering credentials — all under `VELADESK_DATA_DIR`.
  Needs a persistent volume and a long-running process (VPS, NAS, Docker host).
- **`NODE_ENV=production` requires BOTH `VELADESK_DATA_DIR` and
  `VELADESK_MIGRATIONS_DIR`** — the server refuses to boot without them
  (`apps/web/server/config.ts`). Point migrations at
  `<repo>/packages/database/drizzle`.
- The server binds `HOSTNAME` / `PORT` (Next.js convention). `VELADESK_HOST` /
  `VELADESK_PORT` are read ONLY by the release-package launcher and upgrade
  scripts (the launchers map them to HOSTNAME/PORT; the upgrade scripts use
  VELADESK_PORT to find/stop the running instance), not by `next start` or
  Docker.
- Toolchain: Node ≥ 24 (`.nvmrc`: 24.21.0), pnpm `11.17.0` (root
  `packageManager`), pnpm workspace + Turborepo. `better-sqlite3` is a native
  module (prebuilt binary when the ABI matches; python3/make/g++ as fallback).
- **Update channel**: every release tag publishes a multi-arch image to
  `ghcr.io/ichichuang/veladesk` (`latest` + `v<version>`) via
  `.github/workflows/docker-publish.yml` (triggered by the tag the Release
  workflow creates). Deployed machines update via `docker compose pull`,
  Watchtower, or `scripts/update.sh` (source installs; supports `--check`
  and `--restart` for a systemd timer). DB migrations run automatically at
  boot and are one-way — back up the data dir before upgrading. After the
  FIRST publish, flip the GHCR package visibility to Public once (GitHub →
  Packages → veladesk → settings) or anonymous pulls fail. The v1.0.0
  release archives (zip/tar.gz) have NO update channel — migrating one
  means a fresh Docker/source install with `VELADESK_DATA_DIR` pointed at
  (or copied from) the old platform data dir; the DB migrates forward on
  first boot.

## Fastest deploy (verified)

```bash
git clone https://github.com/ichichuang/veladesk.git && cd veladesk
docker compose up -d --build          # data in named volume `veladesk-data` → /data
curl -s http://127.0.0.1:3000/api/v1/workspaces   # → {"workspaces":[]} on a fresh install
```

From source instead:

```bash
pnpm install && pnpm build
cd apps/web
NODE_ENV=production \
VELADESK_DATA_DIR=/srv/veladesk/data \
VELADESK_MIGRATIONS_DIR=<repo>/packages/database/drizzle \
HOSTNAME=0.0.0.0 PORT=3000 \
node node_modules/next/dist/bin/next start    # do NOT run .bin/next via `node`
```

Full guide with reverse-proxy examples, systemd unit, backup/upgrade:
`docs/DEPLOYMENT.md`.

## Security model an operator must know before exposing the instance

- Default experience is read-only **Use mode**; editing lives behind
  **Engineering mode**, gated by a password. **Factory default password is
  `123456`** (`apps/web/server/engineering/password.ts`). The gate: 7 rapid
  clicks (≤400ms apart) on brand/title areas or empty desktop background →
  password dialog. Change it in Settings → General after first unlock.
- Reads are public; EVERY mutating API route (workspace CRUD, asset upload)
  requires an engineering session cookie (httpOnly, 30-min idle expiry).
  Exception: creating the FIRST workspace on an empty server is ungated so
  onboarding works.
- Fresh install: onboarding creates the first workspace without unlocking.

## Known platform limitation

`crypto.randomUUID()` is secure-context-only. Over plain HTTP from any
non-localhost origin, client-side entity creation fails by design. Localhost
is fine; anything else (LAN phones, public domain) needs HTTPS via a reverse
proxy. Document this when the operator asks about LAN or public access.

## Before deploying, ask the operator

1. Target: Docker host, bare VPS/NAS, or something else?
2. Port and domain — and can you provide HTTPS (required off-localhost)?
3. Private (personal) or publicly reachable? If public: plan to change the
   default engineering password immediately after boot.

## Verify after any change

```bash
curl -sf http://127.0.0.1:3000/ -o /dev/null                 # homepage 200
curl -sf http://127.0.0.1:3000/api/v1/workspaces             # JSON, 200
docker ps --filter name=veladesk                             # healthy if Docker
```

## Repo conventions

- `main`-only workflow: commit to main, never branches/PRs.
- Validation is mandatory for every change: `pnpm lint`, `pnpm typecheck`,
  `pnpm test:run` (Vitest). README content is pinned by
  `scripts/readme-contract.test.mjs` — keep user-guide sections intact.
- Dev run: `pnpm install && pnpm dev` (port 3000); dev data defaults to
  `apps/web/.veladesk-data/`.

## UI, motion & interaction conventions (AI-authored work)

Distilled from post-acceptance walkthroughs (2026-11). Detailed motion
inventory: `docs/architecture/motion.md`. When touching UI, these are
binding unless a change explicitly supersedes them:

- **Motion is dual-driver.** GSAP (`components/vd/gsap.ts`) AND
  `motion/react` (e.g. the section pill's `layoutId` highlight) coexist,
  plus `VdAnimatedSurface` / `useVdPresence` on dialogs and CSS transitions.
  When auditing "does X animate", search ALL of them — a `gsap`-only scan
  misreports covered surfaces as gaps. Durations/eases come only from
  `motion-tokens.ts` / `--vd-motion-*`; never hardcode ms or easing.
- **GSAP tweens must hand inline styles back.** A tween that ends on an
  inline value (e.g. `opacity: 1`) outranks every stylesheet rule and
  silently kills state-driven CSS (see `EngineeringBadge`'s
  `clearProps: "opacity"`). End entrance animations with `clearProps`.
- **Structural reserves transition.** When preferences change reserved
  layout (block visibility → `.vela-section-scroller` padding), the layout
  glides via `transition: padding` — never transform on item/dock/scroll
  families (dnd-kit hard-snap + motion contracts in
  `home-shell-css.test.ts` / `scroll-surface-contract.test.ts`).
- **Overlays dodge what is already there.** Dock tooltips use
  `side="right"` (the section pill sits directly above the dock); keyboard
  context menus anchor at the element's right edge
  (`contextMenuAnchorFromElement`), never on top of the target. Before
  adding a floating surface, name what occupies each side of its anchor.
- **focus-visible is per-surface.** Controls keep the shared 2px ring
  (`[data-vd-ui] :focus-visible`); scroll hosts use the quiet 1px inset
  rule in `packages/ui/src/tokens.css`; context-menu rows use wash fill
  (home-shell.css `.vela-context-menu__item:focus-visible`). Never let the
  global ring paint a full pane or fight a glass surface.
- **Loading = skeleton, empty = centered state.** First-page loads render a
  skeleton grid (icon picker), not a caption; empty results render centered
  icon + copy + the obvious next action inside their owning area (see
  `icon-picker.tsx`). New copy goes through both i18n catalogs **in the
  same edit** — `TranslationKey` derives from zh-CN and en-US is
  `Record<TranslationKey, string>`, so a half-paired key is a compile error.
- **Persistent caches satisfy their readers.** Stores that can change with
  app upgrades carry the version in their key
  (`veladesk:icon-picker-pages:v1:${VELADESK_VERSION}`); writers must
  produce values the strict decoder accepts (round fractional smooth-scroll
  offsets); effects that persist state compare VALUES, never "skip first
  run" (StrictMode double-mounts would resurrect stale writes).
- **JSX**: never open a ternary branch with `{/* comment */}` — it parses
  as an object literal and breaks the file. Use `//` comments there.

## Documentation map

| File | Audience |
| --- | --- |
| `README.md` | End users (Chinese): download packages, LAN use, FAQ |
| `docs/DEPLOYMENT.md` | Deployment: Docker, source, HTTPS, backup, upgrade |
| `docs/DEVELOPMENT.md` | Developers: dev server, tests, architecture pointers |
| `docs/architecture/` | Architecture notes |
| `PROJECT_CONTEXT.md` | Current redesign project state and delivery log |
| `apps/web/AGENTS.md` | Next.js version warning (auto-generated, read before coding) |
