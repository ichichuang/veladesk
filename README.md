# VelaDesk

**Build your browser home, your way.**

> 把浏览器首页，真正变成属于你的桌面。

VelaDesk is an open-source, self-hosted browser start page and personal web desktop built around freedom, customization, and motion.

Create your own workspace with apps, folders, widgets, multiple desktop pages, a customizable dock, dynamic wallpapers, themes, plugins, and free-form drag-and-drop layouts — all through a visual interface.

**No ads. No locked layouts. No YAML required.**

## ✨ Highlights

- 🖱️ **Free-form drag & drop** — arrange apps, folders, and widgets anywhere on your desktop
- 📄 **Multiple desktop pages** with folders and a customizable dock
- 🧩 **Widgets & plugins** — extensible through `@veladesk/plugin-sdk`
- 🎨 **Themes & animated wallpapers** — colors, icons, fonts, and custom CSS/JS
- ✨ **Silky-smooth interactions** — a desktop-grade motion experience in the browser
- 🏠 **Self-hosted** — run it on your own machine or homelab, data stays local

## 🚧 Status

VelaDesk is in early development. Internal packages:

| Package | Purpose |
| --- | --- |
| `@veladesk/desktop-engine` | Desktop grid, layout, collision and selection logic |
| `@veladesk/canvas-engine` | Continuous canvas geometry: rects, snap lattice, resize math, history |
| `@veladesk/domain` | Workspace, entity, page, dock and folder domain contracts |
| `@veladesk/assets` | Content-addressed image asset pipeline |
| `@veladesk/icon-catalog` | Bundled offline icon catalog (Iconify collections) |
| `@veladesk/database` | SQLite persistence (Drizzle migrations) |
| `@veladesk/local-store` | IndexedDB working copy, outbox and local-first sync state |
| `@veladesk/sync` | HTTP workspace synchronization and outbox coordination |
| `@veladesk/client-runtime` | Browser workspace bootstrap and local-first session runtime |

The product version lives in exactly one place — the root `package.json` —
and everything else (Settings display, release archives, git tags, GitHub
Releases) derives from it.

## Download

Official releases:

https://github.com/ichichuang/veladesk/releases/latest

Each release ships a ready-to-run bundle for Windows, Linux and macOS
(the bundle requires Node.js — it is a Next.js standalone server, not a
native installer).

### Quick Start

1. Download the package for your operating system.
2. Extract it.
3. Install [Node.js 24 LTS](https://nodejs.org/).
4. Run `start-veladesk.cmd` (Windows) or `./start-veladesk.sh` (macOS/Linux).
5. Open http://127.0.0.1:3000

By default VelaDesk listens on `127.0.0.1:3000` only. Your workspace data
(SQLite database and uploaded assets) lives in a per-user data directory —
never inside the app folder:

- Windows: `%LOCALAPPDATA%\VelaDesk`
- macOS: `~/Library/Application Support/VelaDesk`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/veladesk`

### Updating

1. Download the new release.
2. Extract it and replace your VelaDesk app folder.
3. Keep using the same user data directory — your workspaces are untouched.

No reinstall, no pnpm, no migration steps needed.

## Development

VelaDesk is developed as a pnpm workspace monorepo.

**Requirements**

- Node.js 24 LTS or newer
- Recommended: Node.js 24 LTS
- pnpm

```bash
pnpm install
pnpm dev
```

Other scripts: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm clean`.

**LAN development**

To reach the dev server from another device on your LAN (e.g. `http://10.100.50.74:3100`), pass the hostnames you will browse from so Next.js does not block dev resources (HMR, fonts) as cross-origin:

```bash
VELADESK_DEV_ALLOWED_ORIGINS=10.100.50.74 \
pnpm --filter @veladesk/web exec next dev \
  -H 0.0.0.0 \
  -p 3100
```

`VELADESK_DEV_ALLOWED_ORIGINS` is a comma-separated hostname list used only by the Next.js development server's origin allowlist; it is not a production setting.

**Workspace overview**

| Path | Description |
| --- | --- |
| `apps/web` | Next.js (App Router) web application |
| `packages/desktop-engine` | Desktop grid, layout, collision and selection logic |
| `packages/ui` | VelaDesk UI adapter layer |
| `packages/shared` | Shared types and pure utilities |
| `docs/architecture` | Engineering and architecture notes |

## 🤝 Contributing

Contributions are welcome once the codebase lands. In the meantime, feel free to open issues for ideas and feedback.

## License

Released under the [MIT License](./LICENSE).
