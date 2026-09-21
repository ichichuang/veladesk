# Appearance & Settings

Task 014 introduces the workspace appearance model, the Settings Center and
the workspace-scoped theme rendering pipeline; task 017 redesigns the
Settings Center into a compact product-facing V2 surface (Appearance /
Layout / General) with coherent motion. It is an appearance foundation:
presets and ranges only — no Theme Studio, no custom CSS, no custom
wallpaper URLs.

## Responsibility

- `@veladesk/domain` — persisted preference contracts: the
  `WorkspaceAppearancePreferences` type, exact defaults
  (`DEFAULT_WORKSPACE_APPEARANCE`), resolution for legacy snapshots
  (`resolveWorkspaceAppearance`), semantic range validation
  (`validateWorkspaceAppearance`), and the immutable preferences edit
  (`replaceWorkspacePreferences`).
- web theme adapter (`apps/web/features/home/appearance-theme.ts`) —
  `buildAppearanceTheme` maps an appearance to the controlled `--vd-*` CSS
  custom properties plus the `data-vd-color-mode` / `data-vd-wallpaper`
  attributes applied on the desktop shell root. Closed allowlist of
  variables; never arbitrary CSS.
- Settings Center (`settings-center.tsx`) — draft + presentation only. It
  imports neither the client runtime nor persistence; preview and save are
  callbacks into the shell.
- client-runtime / local-store — local staging of the edited snapshot
  (the standard `stageWorkspaceUpdate` path, nothing appearance-specific).
- sync / server / SQLite — remote persistence of the snapshot JSON; the
  appearance rides inside `preferences`, with no schema change anywhere.

## Backward compatibility

`preferences.appearance` is an **optional** field. Snapshots persisted
before appearance existed:

- decode successfully (structural decoder accepts the missing field),
- validate successfully (semantic validation runs only when present),
- resolve to `DEFAULT_WORKSPACE_APPEARANCE` at render time,
- stay untouched until the user actually saves Settings — resolution never
  writes a migration into the working copy.

Legacy GET/PUT over HTTP keeps working with appearance-free snapshots; a
legacy snapshot saved back stays appearance-free.

## Appearance model

`WorkspaceAppearancePreferences` has exactly seven fields:

| Field | Type | Range / values |
| --- | --- | --- |
| `colorMode` | `"system" \| "dark" \| "light"` | enum |
| `accentHue` | integer | 0–359 (OKLCH hue) |
| `wallpaperPreset` | `"aurora" \| "midnight" \| "dawn" \| "mist"` | enum |
| `surfaceOpacity` | finite number | 0.35–0.9 |
| `blurPx` | integer | 0–32 |
| `radiusPx` | integer | 8–24 |
| `iconSize` | `"small" \| "medium" \| "large"` | enum (icon box only; grid is never affected) |

Enum legality is structural (decoder); numeric ranges are semantic
(`validateWorkspaceAppearance`, reported as
`invalid-appearance-preference` issues in the fixed order hue → opacity →
blur → radius).

## Defaults

```ts
DEFAULT_WORKSPACE_APPEARANCE = {
  colorMode: "dark",
  accentHue: 205,
  wallpaperPreset: "aurora",
  surfaceOpacity: 0.55,
  blurPx: 18,
  radiusPx: 14,
  iconSize: "medium",
}
```

These double as the Task013 visual baseline: legacy workspaces render
exactly like the pre-settings desktop. `createEmptyWorkspace` stores the
defaults explicitly (fresh workspaces carry an appearance from birth).

## Settings V2 structure (017)

- **Appearance** leads with what people actually change: color mode as a
  compact segmented control, one accent control, wallpaper cards. Surface
  opacity / blur / corner radius fold into a collapsed **Advanced** group
  (`aria-expanded` toggle, animated grid-rows expansion). The global Icon
  Size control is removed from the UI; the persisted `iconSize` field stays
  valid and is preserved verbatim when saving unrelated settings.
- **Layout** owns the default section, the Start-in-View switch (backed by
  `layoutLocked`) and the **grid gap** slider (`gridGapPx`, 0–32 step 4) —
  the gap is layout geometry, not appearance, so it lives on
  `WorkspacePreferences` and validates as `invalid-grid-gap`.
- **General** owns the interface language (browser-local, immediate,
  never part of the draft).
- The dialog is ~740px wide with a lower maximum height, a ~152px left
  nav, quieter borders, proper switch treatment for booleans and radio
  semantics for segmented choices; the footer stays Cancel / Save with
  Save disabled while the draft is clean.
- Motion: backdrop fade, opacity + small translateY/scale dialog
  entrance, an 8–12px directional cross-fade when switching sections
  (content remounts keyed by section), the advanced expand/collapse
  animation, 120–180ms control state transitions — all disabled under
  `prefers-reduced-motion`, with no animation library.

## Preview

The Settings Center edits a session-only draft. Every appearance control
change pushes the draft appearance to the shell, which renders it
immediately — but a preview is never staged, never synced and never bumps
`localGeneration`. Cancel (Escape, backdrop, Cancel button) drops the
preview and the desktop reverts to the persisted appearance.

## Save

Save runs the single domain write-path:
`preferencesFromSettingsDraft` → `replaceWorkspacePreferences` (validates
default page + appearance; on failure Settings stays open with an inline
error) → `stageWorkspaceAndTrySync` (local stage, then an explicit sync
attempt). On success the shell closes Settings and clears the preview —
the persisted snapshot already carries the appearance, so no theme
flash-back. A staging failure keeps Settings open with the preview alive;
offline saves keep the new theme locally (dirty/Offline) and sync later.

## Color mode

`dark`, `light`, `system`. The desktop root carries
`data-vd-color-mode`; dark is the Task013 palette, light is a complete
readable palette (background, surface, surface-strong, border, text,
muted text, accent contrast), and system resolves through the CSS
`prefers-color-scheme` media query only — no JS `matchMedia`, no
preference writes.

## Wallpaper

CSS preset gradients only (`data-vd-wallpaper`): aurora (the Task013
default multi radial-gradient), midnight (deep blue/violet), dawn (muted
warm), mist (low-chroma neutral). Blob geometry is shared; presets set
blob hues/chroma factors and the mode palettes set lightness/alpha, so
every preset reads in dark and light. No network images, no base64, no
canvas, no WebGL.

## Scope

No custom wallpapers, no uploads, no Theme Studio, no arbitrary CSS, no
hex color input, no font picker, no dock appearance, no grid editor, no
schema migrations (SQLite, Dexie or localStorage) — the appearance lives
only inside the workspace snapshot JSON.
