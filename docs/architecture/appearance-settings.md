# Appearance & Settings

Task 014 introduces the workspace appearance model, the Settings Center and
the workspace-scoped theme rendering pipeline; task 017 redesigns the
Settings Center into a compact product-facing V2 surface (Appearance /
Layout / General) with coherent motion. Task 019-D makes the semantics
product-grade: the raw surface CSS values fold into one **Interface style**
choice, the component system for Settings + the App Appearance Inspector
becomes canonical (HeroUI v3 themed through VelaDesk's semantic tokens), and
motion unifies under shared tokens. It is an appearance foundation: presets
and ranges only — no Theme Studio, no custom CSS, no custom wallpaper URLs.

## Responsibility

- `@veladesk/domain` — persisted preference contracts: the
  `WorkspaceAppearancePreferences` type, exact defaults
  (`DEFAULT_WORKSPACE_APPEARANCE`), resolution for legacy snapshots
  (`resolveWorkspaceAppearance`), the interface-style resolver
  (`resolveInterfaceStyle`) and nearest-preset inference
  (`inferInterfaceStyle`), semantic range validation
  (`validateWorkspaceAppearance`), and the immutable preferences edit
  (`replaceWorkspacePreferences`).
- web theme adapter (`apps/web/features/home/appearance-theme.ts`) —
  `buildAppearanceTheme` maps an appearance to the controlled `--vd-*` CSS
  custom properties plus the `data-vd-color-mode` / `data-vd-wallpaper`
  attributes applied on the desktop shell root. Closed allowlist of
  variables; never arbitrary CSS. Surface parameters always flow through
  the domain resolver.
- Settings Center (`settings-center.tsx`) — draft + presentation only. It
  imports neither the client runtime nor persistence; preview and save are
  callbacks into the shell.
- App Appearance Inspector (`app-appearance-inspector.tsx`) — per-app draft
  + presentation only; the REAL desktop item is the preview (019-C).
- client-runtime / local-store — local staging of the edited snapshot
  (the standard `stageWorkspaceUpdate` path, nothing appearance-specific).
- sync / server / SQLite — remote persistence of the snapshot JSON; the
  appearance rides inside `preferences`, with no schema change anywhere.

## Appearance ownership matrix (019-D audit)

Every appearance control, traced end-to-end
(UI → draft → preview → preferences → theme builder → CSS variable →
consuming selector), with its product classification:

| Field | Chain | Classification |
| --- | --- | --- |
| `colorMode` | segmented control → draft → `onPreviewAppearance` → `buildAppearanceTheme().colorMode` → `resolveEffectiveColorMode` (021-R1: `system` resolved in JS against `prefers-color-scheme`, live) → `data-vd-color-mode` on `.vela-desktop` + portal root → `home-shell.css` desktop palettes and `vd-ui.css` `--vdu-*` palettes (light block keyed on the effective value) | **A — PRODUCT_SETTING** |
| `accentHue` | accent swatches / custom picker → draft → preview → `--vd-accent-hue` on both roots → `--vdu-accent*` (all designed controls) and `--vd-accent*` (desktop) | **A — PRODUCT_SETTING** (raw hue-degree slider demoted; curated swatches are primary, a custom picker is secondary) |
| `wallpaperPreset` | wallpaper cards → draft → preview → `data-vd-wallpaper` on `.vela-desktop` → `home-shell.css` gradient presets (swatches in Settings mirror them) | **A — PRODUCT_SETTING** |
| `interfaceStyle` (019-D) | style cards → draft → preview → `resolveInterfaceStyle` → `--vd-surface-opacity` / `--vd-surface-strong-opacity` / `--vd-blur` / `--vd-radius` / `--vd-surface-border-strength` / `--vd-surface-shadow` → desktop surfaces (section cards, dock, folder overlay, wheel hint) | **A — PRODUCT_SETTING** |
| `surfaceOpacity`, `blurPx`, `radiusPx` | (legacy fields) persisted numbers → theme surface tokens, as above | **B — INTERNAL_THEME_PARAMETER**: resolved by the interface style; **not** exposed as raw sliders. Persisted for compatibility (D), normalized to the canonical preset values at every Settings save |
| `iconSize` | no control since Settings V2; persisted verbatim → `ICON_SIZE_PX` → `--vd-icon-size` → grid tile icon box only | **B — INTERNAL_THEME_PARAMETER** (dormant; grid cells and drag metrics never change) |
| dialog/inspector window surfaces (`--vdu-window*`) | follow the interface style when one is active (`--vd-window-alpha` / `--vd-window-blur`, emitted only when a style is persisted or previewed): picking Clean/Soft/Glass restyles the Settings window, dialogs, the Inspector and popovers IN PLACE — the live preview is visible where the user is looking | **A — PRODUCT_SETTING carrier**; legacy snapshots (no style) keep the solid 018 window exactly |

Legacy dead controls removed in 019-D: the **Advanced appearance** group
(raw `surfaceOpacity` / `blurPx` / `radiusPx` sliders), the accent
hue-degree slider (primary path), and the footer "Up to date" pseudo-status
(no update subsystem exists; the string was about draft state and read like
a version check).

## Component system (019-D, theme boundary re-grounded 021-R1)

Settings and the App Appearance Inspector are the pilot surfaces for the
canonical component library: **HeroUI v3** (`@heroui/react` +
`@heroui/styles`), chosen because it ships finished, polished components on
Tailwind CSS v4 + React Aria with no provider and no extra animation
runtime. Theming is a one-way bridge in `apps/web/app/vd-ui.css`: HeroUI's
semantic CSS variables (`--background`, `--surface`, `--accent`, `--focus`,
`--radius`, …) are defined on `[data-vd-ui]` from the `--vdu-*` token layer,
so HeroUI components inherit the workspace color mode and accent hue on
both the desktop root and the overlay portal root — no library default
palette leaks through.

**The theme boundary contract (021-R1).** Every themed root — the desktop
and the shared overlay portal root — carries the same *effective* color
mode: the shell resolves the product's `system` choice against
`prefers-color-scheme` in JS (`resolveEffectiveColorMode` + a matchMedia
listener in `desktop-shell.tsx`) BEFORE emitting `data-vd-color-mode`, so
no surface ever inherits the raw `system` preference (the CSS media-query
branches were superseded and removed). Every overlay portal mounts into
the themed portal root:

- Radix portals (dialogs, popovers, tooltips, the Radix select) read the
  container through `useVdPortalContainer` (their `container` prop).
- React Aria / HeroUI overlays (the HeroUI Select popup) route through
  react-aria's supported portal-container integration
  (`UNSAFE_PortalProvider` from `react-aria`) at TWO scopes: the shell's
  `VdHeroOverlayScope` (`components/ui/overlay-scope.tsx`) points at the
  themed portal root for overlays opened outside any dialog, and each Radix
  dialog re-provides it INSIDE its content element (`DialogContent` in
  `components/ui/dialog.tsx`), so a HeroUI popup opened from within a modal
  mounts as a DOM descendant of that dialog. That nesting is required for
  correct modal interop: while a Radix modal is open, react-remove-scroll
  puts `pointer-events: none` on `body` and only the dialog's own subtree
  re-enables it, and Radix treats pointerdown outside the dialog as
  outside-dismissal — a popup portalled to the global root rendered fine
  but could never be clicked. Inside the dialog, pointer events,
  outside-dismissal, the focus scope and the scroll-lock shard all agree,
  the popup still inherits the themed portal root's palette by ancestry,
  and react-aria's positioning measures the container with
  getBoundingClientRect, so the content's resting centering transform is
  accounted for. Without ANY provider these overlays fall back to
  `document.body`, OUTSIDE both themed roots: the popup then inherits the
  always-dark `:root` token fallback for its surface while its text
  `color` falls back to the UA default — the defect 021-R1 repaired.

The bridge covers EVERY semantic variable the installed `@heroui/styles`
components consume — including the derived field-border mixes and the
scrollbar aliases (`--scrollbar-*`) — because an unbridged alias silently
inherits the library's light-theme `:root` layer-base value regardless of
the resolved mode. `color-scheme` is declared per effective mode so native
scrollbars and UA widgets match the palette. The popup surface token
(`--overlay` → `--vdu-overlay`) floors its alpha at 0.9 — option text must
stay readable over any wallpaper, so popups never inherit arbitrary
app-tile translucency. Selected list-box options get a boundary-owned
accent wash plus the composed `ListBox.ItemIndicator` checkmark (the
library's base styles leave `aria-selected` invisible); keyboard focus
rides the bridged `--focus` ring. Contract and color-pair coverage lives
in `vd-ui-theme-contract.test.ts` (bridge completeness, alpha floor,
`color-scheme`, WCAG contrast of the DECLARED pairs — popup labels and
primary-button text against every accent hue — computed with alpha
compositing, not a DOM emulator) and `settings-theme-boundary.test.tsx`
(jsdom: the real SettingsCenter inside the shell wiring opens the real
Select; the popup must mount inside the themed portal root, in both modes,
across a live preview flip, and share the Settings window's portal root).

Surface audit (021-R1): Settings default-section Select, icon-picker source
Select, Radix dialogs/popovers/alert-dialogs/tooltip — canonical boundary.
Launcher, context menus, folder overlay, dock tooltip — render in-flow
inside the themed desktop root; canonical by inheritance. Lab pages and
boot screens — intentionally isolated: no shell, `:root` fallback palette
(documented in `overlay-scope.tsx`).

Motion ownership (019-D): the component library owns control-internal
feedback (hover, press, focus, switch thumb, slider thumb, selection); the
Motion library owns surface enter/exit (Settings window, Inspector, icon
picker, section-content switches); CSS owns simple color/opacity
transitions. Dialog *window* chrome keeps the existing Radix+Motion
`Dialog` wrapper — HeroUI owns the controls inside it. Grid/Freeform drag,
resize and snap landing never receive UI-motion tokens.

## Interface style model

```ts
type WorkspaceInterfaceStyle = "clean" | "soft" | "glass";

interface InterfaceStyleParameters {
  surfaceOpacity: number;        // inside the persisted 0.35–0.9 range
  surfaceStrongOpacity: number;  // shared formula min(0.98, base + 0.23)
  blurPx: number;                // 0–32
  radiusPx: number;              // 8–24
  borderStrength: number;        // 0–1, CSS maps it to a mode-aware color
  shadowPreset: "none" | "subtle" | "elevated";
}
```

- `clean` — 0.90 / blur 0 / radius 10 / border 0.9 / shadow none
  (high readability, crisp edges, no backdrop blur)
- `soft` — 0.72 / blur 10 / radius 14 / border 0.5 / shadow subtle
- `glass` — 0.50 / blur 24 / radius 18 / border 1.0 / shadow elevated
  (translucent, meaningful backdrop blur, bright border, stronger elevation)

`resolveInterfaceStyle(style)` is the single canonical resolver;
`buildAppearanceTheme` consumes it — Settings, Inspector, dialogs and
popovers never invent their own surface formula. The desktop CSS maps
`--vd-surface-border-strength` to a mode-aware border color and consumes
`--vd-surface-shadow` directly; the overlay window layer
(`--vdu-window`) derives from `--vd-window-alpha` / `--vd-window-blur`,
which are emitted only while a style is active, so the style choice is
immediately visible on the Settings window itself and every dialog.

### Legacy compatibility

`interfaceStyle` is **optional**. Snapshots persisted before 019-D:

- decode successfully (the structural decoder accepts the missing field,
  and rejects values outside the enum, like every other enum field),
- render from their persisted `surfaceOpacity` / `blurPx` / `radiusPx`
  exactly as before — no visual change on load, no bulk migration,
- open Settings with the **nearest** preset inferred for display
  (`inferInterfaceStyle`, a deterministic weighted distance over the three
  surface values; never written back by opening or cancelling).

Saving Settings always normalizes: the chosen style's canonical values are
written into `surfaceOpacity` / `blurPx` / `radiusPx` and the
`interfaceStyle` is persisted, so the raw fields and the style can never
disagree after a save. `DEFAULT_WORKSPACE_APPEARANCE` deliberately does not
carry an `interfaceStyle`: the defaults double as the Task013 visual
baseline (0.55/18/14), and legacy snapshots must keep rendering it until
the user actually saves.

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

`WorkspaceAppearancePreferences` has these fields:

| Field | Type | Range / values |
| --- | --- | --- |
| `colorMode` | `"system" \| "dark" \| "light"` | enum |
| `accentHue` | integer | 0–359 (OKLCH hue) |
| `wallpaperPreset` | `"aurora" \| "midnight" \| "dawn" \| "mist"` | enum |
| `surfaceOpacity` | finite number | 0.35–0.9 (style-normalized at save) |
| `blurPx` | integer | 0–32 (style-normalized at save) |
| `radiusPx` | integer | 8–24 (style-normalized at save) |
| `interfaceStyle` | `"clean" \| "soft" \| "glass"` | enum, optional (019-D); absent = legacy, inferred for display |
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
defaults explicitly (fresh workspaces carry an appearance from birth) —
without an `interfaceStyle`, so even fresh workspaces render the exact
baseline until their first Settings save.

## Settings structure (019-D)

- One stable window: ~900×640 envelope (viewport-bounded), fixed branded
  header, fixed-width left navigation (designed full-width centered tab
  rows — a sidebar nav is product chrome, not a HeroUI Tabs strip),
  independently scrollable content pane, fixed footer. Switching sections
  never resizes or re-centers the window; only the pane content
  transitions (220 ms directional cross-fade, Motion-owned).
- **Appearance**: color mode (segmented), accent (curated swatches +
  secondary custom picker popover), wallpaper (2-column visual cards with a
  clear selected state), interface style (Clean / Soft / Glass preview
  cards). No raw opacity/blur/radius sliders and no Advanced group.
- **Layout**: default section (HeroUI Select), Start-in-View switch,
  grid gap slider (real layout geometry, 0–32 step 4).
- **General**: interface language (browser-local, immediate, never part of
  the draft). No update-check status — the product has no update subsystem.
- The footer shows an inline error or the saving state; draft-dirtiness is
  expressed by the enabled Save button.

## Preview

The Settings Center edits a session-only draft. Every appearance control
change pushes the draft appearance to the shell, which renders it
immediately — but a preview is never staged, never synced and never bumps
`localGeneration`. Cancel (Escape, backdrop, Cancel button) drops the
preview and the desktop reverts to the persisted appearance.

## Save

Save runs the single domain write-path:
`preferencesFromSettingsDraft` (which normalizes the interface style into
the canonical surface values) → `replaceWorkspacePreferences` (validates
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
font picker, no dock appearance, no grid editor, no schema migrations
(SQLite, Dexie or localStorage) — the appearance lives only inside the
workspace snapshot JSON. No Smart Link Recognition (explicitly out of
scope for 019-D).
