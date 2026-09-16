# VelaDesk Engineering Foundation

This document records the engineering foundation of the VelaDesk repository: workspace layout, toolchain, and the decisions behind them. Product features (desktop engine logic, drag & drop, animations, persistence, UI design) are explicitly out of scope for this stage.

## Workspace layout

```
veladesk/
├── apps/
│   └── web/              # Next.js (App Router) application — the deployable unit
├── packages/
│   ├── desktop-engine/   # Pure-logic desktop grid, layout, collision, selection (no UI)
│   ├── ui/               # VelaDesk self-built UI adapter layer (future)
│   └── shared/           # Shared types and pure utilities
├── docs/
│   └── architecture/     # Engineering notes (this document)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── package.json
```

## Toolchain

| Tool | Version (pinned via lockfile) | Notes |
| --- | --- | --- |
| Node.js | >= 20.9.0 (`engines`), dev baseline pinned via `.nvmrc` | Runtime baseline per project requirements |
| pnpm | 11.17.0 (`packageManager`) | Workspace manager |
| Next.js | 16.3.5 | App Router, Turbopack default, `output: "standalone"` |
| React / react-dom | 19.3.0 | |
| TypeScript | 5.9.3 | Strict flags in `tsconfig.base.json` |
| Tailwind CSS | 4.3.3 | Via `@tailwindcss/postcss` |
| Turborepo | 2.10.13 | Task orchestration only (`build`, `typecheck`, `dev`) |
| Vitest | 5.0.1 | Requires Node >= 22.12 for the dev toolchain |
| ESLint | 10.10.0 | Flat config at repository root, `eslint-config-next` 16.3.5 |

## Key decisions

- **Internal packages are source-only.** `packages/*` export TypeScript source (`src/index.ts`) with no build step. The app consumes them through Next.js `transpilePackages`, and Vitest transforms them natively. This avoids per-package build pipelines until they are actually needed.
- **Turborepo stays minimal.** Only `build`, `typecheck`, and `dev` tasks are defined. Lint and tests run directly from the root (single ESLint config, single Vitest configuration) instead of duplicating config files per package.
- **Strict TypeScript everywhere.** All configs extend `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, and `exactOptionalPropertyTypes`.
- **Standalone output.** `apps/web` builds with `output: "standalone"` for the future Docker-based self-hosting story. No webpack customization; Turbopack is the Next.js 16 default and no experimental flags are enabled.
- **Commit 1 of this branch intentionally ships no app code** — it establishes the workspace graph so later commits stay reviewable.

## Verification

From the repository root:

```bash
pnpm install
pnpm typecheck   # turbo: all packages + app
pnpm lint        # eslint at root
pnpm test:run    # vitest workspace run
pnpm build       # turbo: next build (standalone)
```
