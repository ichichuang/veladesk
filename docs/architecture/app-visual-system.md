# App Visual System

## Responsibility

Task 016-A gives every app shortcut its own visual identity: a per-app
icon size, foreground color, decoration color and decoration style, plus
a searchable, fully self-hosted icon catalog. The layering:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `@veladesk/domain` | `AppVisualStyle` / `AppDecorationStyle` types, defaults, semantic ranges, structural decoding | Rendering, catalog data, CSS |
| `@veladesk/icon-catalog` | Bundled collections, search index, SVG generation (pure data) | HTTP, React, persistence |
| `apps/web/server` | Icon HTTP handlers (search + SVG), status mapping | Icon data ownership |
| `apps/web/features/home` | `AppIconRenderer`, picker + visual editor UI, controlled CSS composition | Domain ranges, catalog parsing |

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

The four bundled collections are `simple-icons`, `lucide`, `tabler` and
`ph`; there is exactly ONE `iconify` variant, not one per collection.
Generated text icons gained `source`: `auto` (explicit) or the legacy
`undefined` means the initials derive from the app name and follow
renames; `custom` means the user owns the text and renames never touch
it. Add App creates `source: "auto"`; the visual editor writes `custom`
when the user types their own text.

## Per-app visual style (`AppVisualStyle`)

```ts
interface AppVisualStyle {
  iconScale: number;              // 0.5 – 1.6, finite (semantic range)
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

Colors are a persisted-data boundary: only exact `#RRGGBB` passes
`isValidAppHexColor`. Arbitrary CSS, `var(...)`, `url(...)`, `rgb(...)`,
`oklch(...)`, gradients — everything else is rejected at validation and
additionally ignored defensively by the renderer's var composition.

### Scale is visual, never layout

`iconScale` is a multiplier on the global base icon size
(`baseIconSize × iconScale`, e.g. Medium 62px × 120% = 74.4px). It scales
the icon BOX only: `LayoutItem.span` stays 1×1, grid cells, drag
collision and snap logic never see it, and a 160% icon may visually
overflow its slot. Tile spans are a different, future task.

### Colors

- `foregroundColor` tints the glyph (text color for text icons, mask
  background for library icons). Auto = the current default foreground.
- `decorationColor` feeds the tile background. Auto = the pre-016
  gradient (gradient style) or the style's own default constant. For the
  gradient style the renderer composes a controlled two-stop gradient by
  shading the validated hex; solid uses the hex directly; glass converts
  it to a translucent rgba; none ignores it.

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

`@veladesk/icon-catalog` wraps the four pinned `@iconify-json/*`
packages. Hard rules:

- No network. `api.iconify.design`, CDNs and every other remote icon
  source are never contacted; all data ships from `node_modules` with the
  server. Browser verification requires zero third-party requests.
- Server-side pure data: no React, no DOM, no Next, no database.
- Collections are loaded once per process (lazy singleton promise) and
  normalized into a search index on first use — no per-request JSON
  parsing. Aliases are searchable and resolvable (`lucide:home` →
  `house`); hidden icons are excluded from search/browse.

### Search API

`GET /api/v1/icons/search?q=&collection=&limit=`

- `q`: at most 100 code points; missing/empty = browse mode (a
  collection's name-ascending head, or curated starter icons without a
  collection).
- `collection`: one of the four ids; anything else is `400
  unknown-collection`.
- `limit`: canonical 1–100, default 60; anything else is `400
  invalid-limit`; an over-long/non-string `q` is `400 invalid-query`.
- Ranking is deterministic: exact, then prefix, then word-prefix, then
  substring; ties break by collection order (brands first), then name
  ascending. No fuzzy matching.

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

One renderer everywhere: desktop items, dock buttons and the editor
preview. Library icons render through a CSS **mask**
(`mask-image: url(/api/v1/icons/…)`) whose background color IS the
foreground color — this supports per-app tinting, which an `<img>` cannot
do, and avoids `innerHTML` entirely. The URL is built only from a parsed,
validated id (`parseIconifyIconId`), so quoting is safe.

Uploaded assets (`kind: "asset"`) render through a local-first object URL
(`useAssetImageUrl`: IndexedDB blob hit, hash-verified remote GET +
hydrate on a miss) as a plain `<img>` (`object-fit: contain`) inside the
decoration tile — they keep their OWN colors (`foregroundColor` is
ignored for them), while decoration styles and `iconScale` still apply.

A 404 or load failure (probed with an `Image()` preload for library
icons, the asset runtime's failure result for uploads) degrades to the
generated text initials — a broken icon never renders as a broken image,
and recovery is automatic on the next successful load. Text icons show
`icon.text` (derived initials when blank); `favicon` shows derived
initials.

## Icon Picker and Visual Editor

- `icon-picker.tsx`: debounced search (~150ms), collection tabs (全部 /
  品牌 / Lucide / Tabler / Phosphor), a local scroll grid
  (`data-vd-wheel-scope="local"` so wheeling never pages the section
  stack), and a one-line brands ownership note. Keyboard: the search
  field takes focus on open; results are plain buttons (Tab, Enter/Space)
  with `label · collection` aria-labels.
- `app-visual-editor.tsx`: opened from the app context menu's
  编辑外观… / Edit appearance…. Icon source tabs are 图标库, 文字
  (auto/custom), and 上传图片 — REAL since 016-B: a dropzone supporting
  click-to-choose, drag-and-drop and clipboard paste; files are validated
  immediately (4 MiB budget, magic bytes, browser decode, 4096×4096
  dimension budget) and kept in component state ONLY — the blob is
  staged into the asset store at Save, BEFORE the workspace mutation
  (ordering enforced by the asset-aware sync transport). Editing an app
  that already has an uploaded icon opens the upload tab with the
  current image and never re-stages unless a new file is chosen. A live
  preview renders the draft through `AppIconRenderer`. Everything edits
  the draft only: Save runs (asset stage →) `replaceApp` → local stage
  → sync attempt (and is disabled while the draft equals the persisted
  state); Cancel closes with zero mutation — a pending upload is
  discarded without ever touching IndexedDB or the workspace.

## What 016-A deliberately did not do — and 016-B delivered

016-A shipped without real upload support. 016-B added it end to end
(content-addressed assets, a dedicated IndexedDB store with outbox, the
self-hosted `/api/v1/assets` binary API, server-side
`VELADESK_DATA_DIR/assets` persistence, and asset-before-workspace sync
ordering) — see [assets.md](./assets.md). Still out of scope: favicon
fetching, remote image URLs, SVG/GIF uploads, image crop/resize pipelines,
and any base64 in the workspace.
