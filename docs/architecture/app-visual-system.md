# App Visual System

## Responsibility

Task 016-A gives every app shortcut its own visual identity: a per-app
icon size, foreground color, decoration color and decoration style, plus
a searchable, fully self-hosted icon catalog. Task 016-C adds the rich
multicolor catalog, paginated browsing, the fixed editor shell and
Arrange-mode resizing. The layering:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `@veladesk/domain` | `AppVisualStyle` / `AppDecorationStyle` types, defaults, semantic ranges, structural decoding | Rendering, catalog data, CSS |
| `@veladesk/icon-catalog` | Bundled collections, browser-safe metadata (`/meta`), search index, pagination, SVG generation (pure data) | HTTP, React, persistence |
| `apps/web/server` | Icon HTTP handlers (search + SVG), status mapping | Icon data ownership |
| `apps/web/features/home` | `AppIconRenderer`, picker + visual editor UI, Arrange resize session, controlled CSS composition | Domain ranges, catalog parsing |

## Icon identity (`AppIcon`)

Icon identity is unchanged and stays a small closed union in the domain:

- `{ kind: "iconify", icon: "<collection>:<name>" }` — a library icon;
- `{ kind: "generated", text, source?: "auto" | "custom" }` — a text icon;
- `{ kind: "asset", assetId }` — an UPLOADED image (task 016-B): rendered
  from a local-first, hash-verified asset store via object URL. The
  workspace stores only the content-addressed id — never base64, never a
  remote URL, never the bytes (see
  [assets.md](./assets.md)). `favicon` remains a reserved kind rendering
  its generated-text fallback; no favicon fetching exists.

The workspace stores ONLY that string — never an SVG body, a palette or
any collection metadata. Palette and category are derived from the
collection id alone (see below), so a snapshot written today renders
correctly under any future catalog build.

### The nine bundled collections

| Collection | Category | Palette | Label |
| --- | --- | --- | --- |
| `simple-icons` | brand | monochrome | Brands |
| `lucide` | general | monochrome | Lucide |
| `tabler` | general | monochrome | Tabler |
| `ph` | general | monochrome | Phosphor |
| `fluent-color` | general | multicolor | Fluent Color |
| `devicon` | development | multicolor | Devicon |
| `vscode-icons` | development | multicolor | VSCode Icons |
| `catppuccin` | development | multicolor | Catppuccin |
| `noto` | emoji | multicolor | Noto Emoji |

There is exactly ONE `iconify` variant, not one per collection. Generated
text icons gained `source`: `auto` (explicit) or the legacy `undefined`
means the initials derive from the app name and follow renames; `custom`
means the user owns the text and renames never touch it. Add App creates
`source: "auto"`; the visual editor writes `custom` when the user types
their own text.

## Per-app visual style (`AppVisualStyle`)

```ts
interface AppVisualStyle {
  iconScale: number;              // 0.5 – 2.0, finite (semantic range)
  decorationStyle: "gradient" | "solid" | "glass" | "none";
  foregroundColor?: string;       // exact #RRGGBB, upper or lower case
  decorationColor?: string;
}
```

`AppShortcut.visual` is OPTIONAL, so every legacy snapshot stays valid
with no migration: the decoder accepts its absence, `validateWorkspace`
checks it only when present (as `invalid-app-visual` issues delegating to
`validateAppVisualStyle` — ranges are never duplicated in
`validation.ts`), and `resolveAppVisualStyle` resolves `undefined` to
`DEFAULT_APP_VISUAL_STYLE` (`{ iconScale: 1, decorationStyle: "gradient" }`).
A legacy app renders exactly like the pre-016 desktop. The persisted
"upgrade" happens only when the user saves the visual editor
(`replaceApp` — identity, page/folder placement and dock pins survive).

Widening the ceiling to 2.0 in 016-C needed no migration either: the new
range is strictly wider, so every snapshot written under the old 0.5–1.6
range remains in range and stays legal.

Colors are a persisted-data boundary: only exact `#RRGGBB` passes
`isValidAppHexColor`. Arbitrary CSS, `var(...)`, `url(...)`, `rgb(...)`,
`oklch(...)`, gradients — everything else is rejected at validation and
additionally ignored defensively by the renderer's var composition.

### Scale is visual, never layout

`iconScale` is a multiplier on the global base icon size
(`baseIconSize × iconScale`, e.g. Medium 62px × 200% = 124px). It scales
the icon BOX only: `LayoutItem.span` stays 1×1, grid cells, drag
collision and snap logic never see it, and a 200% icon may visually
overflow its slot. Tile spans are a different, future task.

Since 016-C the user edits that scale directly: see
[app-resize.md](./app-resize.md).

### Colors

- `foregroundColor` tints the glyph (text color for text icons, mask
  background for monochrome library icons). Auto = the current default
  foreground. It is IGNORED by multicolor library icons and uploaded
  images, which keep their own pigments; the editor hides the control for
  those sources but never deletes the persisted value, so switching back
  to a monochrome source restores the color.
- `decorationColor` feeds the tile background. Auto = the pre-016
  gradient (gradient style) or the style's own default constant. For the
  gradient style the renderer composes a controlled two-stop gradient by
  shading the validated hex; solid uses the hex directly; glass converts
  it to a translucent rgba; none ignores it. Decoration applies to every
  icon source — text, monochrome, multicolor and uploaded alike.

"Auto" is expressed as the ABSENCE of the field — no default hex is ever
persisted as redundant snapshot data.

## Decoration styles

| Style | Tile | Auto look |
| --- | --- | --- |
| `gradient` | controlled two-stop gradient of `decorationColor` | the existing default gradient tile |
| `solid` | the hex directly | a neutral solid constant |
| `glass` | translucent rgba + backdrop blur + border | translucent neutral glass |
| `none` | no tile at all — only the glyph | glyph takes the text color |

## Library catalog (self-hosted only)

`@veladesk/icon-catalog` wraps nine pinned `@iconify-json/*` packages.
Hard rules:

- No network. `api.iconify.design`, CDNs and every other remote icon
  source are never contacted; all data ships from `node_modules` with the
  server. Browser verification requires zero third-party requests.
- Server-side pure data: no React, no DOM, no Next, no database.
- Collections are loaded once per process (lazy singleton promise) and
  normalized into a search index on first use — no per-request JSON
  parsing. A collection is touched only when a scope/collection filter
  actually reaches it. Aliases are searchable and resolvable
  (`lucide:home` → `house`); hidden icons are excluded from
  search/browse.

### Browser-safe metadata (`@veladesk/icon-catalog/meta`)

Which collections exist, their display order, category and palette live
in `src/meta.ts`, which imports NO icon data. The web client imports that
subpath for `ICON_COLLECTIONS`, `findIconCollection`,
`isIconCollectionId`, `IconPalette`, `IconCategory` and `IconSearchScope`
— so adding a collection is a catalog change and nothing else, and no
client bundle ever pulls an icon body in. The server loaders in
`collections.ts` re-export the same metadata; there is no second list.

### Search API

`GET /api/v1/icons/search?q=&scope=&collection=&offset=&limit=`

- `q`: at most 100 code points; missing/empty = browse.
- `scope`: `recommended` (default), `all`, `color`, `brand`, `general`,
  `development`, `emoji`; anything else is `400 invalid-scope`.
  `recommended` with an empty query serves the curated front page and
  with a query searches the whole catalog; `color` filters by
  `palette=multicolor`; the category scopes filter by category.
- `collection`: one of the nine ids; anything else is
  `400 unknown-collection`. Scope and collection are ANDed, so
  `scope=color&collection=devicon` is legal and `scope=brand&
  collection=devicon` is legitimately empty.
- `offset`: canonical non-negative integer, default 0; `limit`: canonical
  1–120, default 96. Both reject non-canonical forms (`"060"`, `"1.5"`,
  negatives) with `400 invalid-offset` / `400 invalid-limit`; an
  over-long/non-string `q` is `400 invalid-query`.
- Response: `{ icons, total, nextOffset }` where `total` is the complete
  filtered match count (page-independent) and `nextOffset` is `null` on
  the last page. Each icon carries `id`, `collection`, `name`, `label`,
  `category` and `palette`, so the picker never guesses how to render it.
- Ordering: with a query, exact → prefix → word-prefix → substring, then
  collection order (brands first), then name ascending. Browsing
  (`scope=all`, empty query) is collection order then name ascending —
  walking `nextOffset` reaches every icon in the catalog, ~29k of them.
  No fuzzy matching, no starter list standing in for `all`.

### SVG route

`GET /api/v1/icons/:collection/:name.svg` (the `.svg` suffix is
optional) generates the SVG in-process with `@iconify/utils`
(`getIconData` → `iconToSVG` → `iconToHTML`) from the bundled JSON —
never from user strings, never with markup assembly. Unresolvable names,
unknown collections and malformed names (strict `[a-z0-9-]+` shape, so
path data is never treated as a file path) are 404. Responses carry
`image/svg+xml` and `Cache-Control: public, max-age=31536000,
immutable` — the icon content is pinned by the package lock, and a
VelaDesk upgrade refreshes assets anyway.

## Rendering (`AppIconRenderer`)

One renderer everywhere: desktop items, dock buttons, the folder overlay,
the editor preview and the picker grid. It splits by PALETTE, never by
convenience:

- **Monochrome** collections render through a CSS **mask**
  (`mask-image: url(/api/v1/icons/…)`) whose background color IS the
  foreground color — this supports per-app tinting, which an `<img>`
  cannot do, and avoids `innerHTML` entirely.
- **Multicolor** collections render as a plain same-origin `<img>` from
  the same route (`object-fit: contain`, `pointer-events: none`), which
  keeps the collection's own pigments. Masking them would flatten every
  color into one accent tint, so the two paths must stay separate.

The URL is built only from a parsed, validated id (`parseIconifyIconId`),
so quoting is safe; there is no CDN, no data URL, no third-party host.
The Picker uses the same split, so multicolor icons show their real
colors BEFORE selection.

Uploaded assets (`kind: "asset"`) render through a local-first object URL
(`useAssetImageUrl`: IndexedDB blob hit, hash-verified remote GET +
hydrate on a miss) as a plain `<img>` inside the decoration tile — they
keep their OWN colors too, while decoration styles and `iconScale` still
apply.

A 404 or load failure (probed with an `Image()` preload for library
icons, the asset runtime's failure result for uploads) degrades to the
generated text initials — a broken icon never renders as a broken image,
and recovery is automatic on the next successful load. Text icons show
`icon.text` (derived initials when blank); `favicon` shows derived
initials.

## Icon Picker (v2)

- Scope tabs: 推荐 / 全部 / 彩色 / 品牌 / 通用 / 开发 / Emoji.
- A source filter listing the scope's own collections (plus 全部), so
  picking a source can never produce an empty grid inside the scope.
- A ~150ms debounced search field; "load more" is never debounced.
- Pages of 96 with a 加载更多 button, appending until `nextOffset` is
  `null`; ids are deduped so a page never repeats an icon.
- Any query/scope/source change resets the offset and REPLACES the grid;
  a generation token drops responses from abandoned queries, and a failed
  page keeps the results on screen with a retry.
- The grid is a local scroll surface (`data-vd-wheel-scope="local"`), so
  wheeling through icons never pages the section stack or moves the
  editor's pinned preview.

## Visual Editor (fixed shell)

`app-visual-editor.tsx` is opened from the app context menu's 编辑外观… /
Edit appearance…. Its layout is a FIXED SHELL:

```
form (grid: auto / minmax(0, 1fr) / auto, height 100%)
├── header   — title, live preview, resize hint   (never scrolls)
├── body     — source tabs, picker / text / upload, decoration, colors
└── footer   — Cancel / Save                      (never scrolls)
```

The dialog itself is `overflow: hidden` with
`width: min(760px, calc(100vw - 32px))` and
`height: min(86vh, 820px)`, and `.vela-visual-editor__body` is the one
scrolling region (`overflow-y: auto`, `min-height: 0`,
`overscroll-behavior: contain`). Measured in the browser: scrolling the
body to its maximum moves the preview's top edge and the footer's bottom
edge by 0.000px. The footer sits outside the scroll region (never a
floating overlay), so Save/Cancel are always reachable.

Icon source tabs are 图标库, 文字 (auto/custom), and 上传图片: a dropzone
supporting click-to-choose, drag-and-drop and clipboard paste; files are
validated immediately (4 MiB budget, magic bytes, browser decode,
4096×4096 dimension budget) and kept in component state ONLY — the blob
is staged into the asset store at Save, BEFORE the workspace mutation
(ordering enforced by the asset-aware sync transport). Editing an app
that already has an uploaded icon opens the upload tab with the current
image and never re-stages unless a new file is chosen.

The editor carries NO size control. Size is edited by dragging the icon's
corners in Arrange mode, and the header says so in one line of text.
`foregroundColor` is hidden (replaced by a one-line note) for multicolor
library icons and uploaded images, whose colors are their own.

Everything edits the draft only: Save runs (asset stage →) `replaceApp`
→ local stage → sync attempt (and is disabled while the draft equals the
persisted state); Cancel closes with zero mutation — a pending upload is
discarded without ever touching IndexedDB or the workspace. The draft
still CARRIES `iconScale` so switching source or colors preserves the
current size.

## What 016-A deliberately did not do — and 016-B / 016-C delivered

016-A shipped without real upload support. 016-B added it end to end
(content-addressed assets, a dedicated IndexedDB store with outbox, the
self-hosted `/api/v1/assets` binary API, server-side
`VELADESK_DATA_DIR/assets` persistence, and asset-before-workspace sync
ordering) — see [assets.md](./assets.md). 016-C added the rich
multicolor collections, paginated browsing, the fixed editor shell and
Arrange-mode resizing — see [app-resize.md](./app-resize.md). Still out
of scope: favicon fetching, remote image URLs, SVG/GIF uploads, image
crop/resize pipelines, and any base64 in the workspace.
