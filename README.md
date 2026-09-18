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
- 🐳 **Self-hosted** — run it on your own machine or homelab with Docker

## 🚧 Status

VelaDesk is in early development (`v0.1.0`). The repository scaffolding is landing now — code is on the way.

Planned internal packages:

| Package | Purpose |
| --- | --- |
| `@veladesk/ui` | Shared UI components |
| `@veladesk/desktop-engine` | Desktop canvas, layout, and drag-and-drop core |
| `@veladesk/domain` | Workspace, entity, page, dock and folder domain contracts |
| `@veladesk/animation-engine` | Motion and interaction effects |
| `@veladesk/wallpaper-engine` | Static and animated wallpapers |
| `@veladesk/plugin-sdk` | Plugin and widget development kit |
| `@veladesk/database` | Storage and persistence |
| `@veladesk/local-store` | IndexedDB working copy, outbox and local-first sync state |
| `@veladesk/sync` | HTTP workspace synchronization and outbox coordination |
| `@veladesk/client-runtime` | Browser workspace bootstrap and local-first session runtime |

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
