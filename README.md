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
| `@veladesk/animation-engine` | Motion and interaction effects |
| `@veladesk/wallpaper-engine` | Static and animated wallpapers |
| `@veladesk/plugin-sdk` | Plugin and widget development kit |
| `@veladesk/database` | Storage and persistence |

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
