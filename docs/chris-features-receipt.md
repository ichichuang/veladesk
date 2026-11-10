# Chris feature closeout — 2026-11-10

Baseline and remote HEAD verified: `main` at `3d37745d00eccbe2d6e69326f0ebeb0468cd7a92`. Work stays in the main working tree; no branches, commits, dependencies, or credential-file reads.

## Audit: existing implementation versus gaps closed

| Requirement | Already present at baseline | Closeout |
| --- | --- | --- |
| Optional image per desktop, generic plus optional light/dark | Domain fields, immutable edit operations, settings scope/layer controls, upload preparation and durable asset staging | Preserved |
| Local IndexedDB blobs | Asset runtime/local-store; snapshots and recipes hold content references | Preserved; browser save/reload checked separately below |
| Mode image → generic image → Dawn | Mode override existed, but final fallback inherited workspace/legacy appearance; failed asset loading stayed blank | Desktop resolution now ends at Dawn. Missing/undecodable mode images fall to generic, then Dawn, without rewriting saved data. Workspace editor retains its separate legacy resolver. Labels now describe Dawn accurately. |
| Replace, delete, preview | HeroUI v3 controls, per-layer drafts, preview URLs, cancel/save and thumbnails | General-layer preview no longer borrows a saved dark override; per-mode editor no longer shows the unrelated general-background toggle |
| Bright-image 6% bg.deep scrim | Canvas luminance sampling/cache, semantic bg.deep overlay | Measurement keyed to URL so stale brightness cannot affect another image; alpha moved into packages/ui tokens |
| 0.45s decoded crossfade, instant reduced motion | GSAP tween used shared 0.45s token and reduced-motion cut | Both DOM image decodes gate the fade; cold assets keep the visible image (Dawn on initial cold mount); rejected decode cannot start a tween |
| Dawn light band over custom photos (full reference notes) | DawnHorizon existed but photos suppressed it | Photos now retain the static horizon; opening animation stays preset-only |
| Per-desktop snap/free selection | PagePlacementMode, settings, queued domain commit | Preserved |
| Snap sizes and push/reflow | 1×1/2×1/2×2/4×2 ladder, engine collision reflow and Motion GridFlipSlot | Step rounding now respects available columns and anchored north/west boundaries |
| Free coordinates/sizes, overlap, z-order | Continuous logical coordinates (0–10,000 normalized units), bounds/minimum-size clamps; overlap allowed; dropped selection raised in item stacking order | Preserved. RecipeV1 exports free coordinates as 0–1 fractions; no coordinate-schema migration needed |
| Drag movement and edge/corner resize | Shared pointer sessions, eight handles, capture/cancel, preview and durable commits | Preserved |
| Preserve each mode’s layout | Retained placement datasets and lossless switch operations | Preserved; domain and tile-host tests pass |
| Free tracking without spring/overshoot | Direct pointer geometry writes; no Motion FLIP wrapper for free tiles | Preserved |
| Ripple only in snap | Snap-only ripple dispatch and reduced-motion gate | Preserved |
| Reduced motion drops in place | Grid already repositioned directly, but ran an opacity animation afterward | Removed the animation; no tween/remount on a reduced-motion geometry change |
| HeroUI, shared tokens, fixed shell/independent scrolling | Existing HeroUI v3/settings architecture and fixed/scroll-container layout | Preserved. Removed eight legacy token-check errors (duration/color literals); removed the inspector’s padding animation, which animated layout |
| Project context | Existing context was stale about recipe delivery and active goal | Rewritten as a short current context; full redesign, HeroUI v3, tokens, GSAP/Motion, optional V1 fields and A–D2 delivery recorded |

## Acceptance evidence

- `pnpm --filter @veladesk/web typecheck` and `pnpm --filter @veladesk/domain typecheck`: clean (`tsc --noEmit`).
- ESLint on every changed TS/TSX file, including the new scene test, with `--max-warnings 0`: clean. CSS is outside the repository’s ESLint configuration; checked with the token checker.
- Full `pnpm exec vitest run`: **223 test files passed; 3,106 tests passed, 1 existing skip (3,107 total)**..
- Added 16 regression cases: missing/corrupt asset fallback (2), desktop fallback (2), resize boundaries (6), cold/decoded transition behavior (4), stale scrim measurement (1), generic editor preview (1). Strengthened reduced-motion and mobile/horizon expectations.
- Home token checker: exit 0, **0 errors, 481 warnings** (existing raw-size declarations; not a full stylesheet redesign). `git diff --check`: clean.
- Browser evidence: Headless Chromium: light/dark settings previews, a real bright PNG upload, automatic scrim, save/reload persistence, static horizon, fixed shell and no document overflow passed in normal and reduced-motion contexts; **0 page errors**. Screenshots and JSON reports are in `/home/box/outsource/tasks/veladesk-chris-features/artifacts/` (`desktop.png`, `wallpaper-{normal,reduced}-{0,150,300,600}.png`, `wallpaper-{light,dark}-{normal,reduced}.png`, `browser-report.json`, `timing-report.json`). Screenshot checkpoint labels are nominal and include screenshot overhead; the separate timing report samples computed opacity without screenshot overhead. Normal-mode computed opacity progressed 0.5533 → 0.8386 → 0.9615 → 1, retiring the second surface by the 600ms checkpoint. Reduced mode stayed at opacity 1 with one surface at every checkpoint. Capture starts after the click, so its first sample is not tween time zero. Unit tests assert the exact 0.45s token and both decode gates..

## Risks and real-device checks

- Browser coverage here is headless Chromium. Check Safari/iOS AVIF/WebP decoding, large images, IndexedDB quota/private mode and touch/pen capture on actual devices. Check rapid desktop/theme changes during image decode and resize on high-DPI displays.
- The scrim remains the specified fixed 6%; luminance classification does not prove text contrast over every possible photograph. Inspect representative bright/busy photos on real displays.
- Failed scene asset ids are skipped for that mounted scene session; remounting retries them. No unavailable reference is deleted from saved data.
- Desktop fallback deliberately stops at Dawn instead of inheriting workspace wallpaper. This changes the previous inheritance behavior to match Chris’s explicit chain; workspace appearance data remains readable/exportable.
- Wallpaper upload still uses the existing shared **4 MiB** effective asset limit; no new dependency or storage format was introduced.
- Existing deferred work remains: 481 raw-size token warnings, full CSS decomposition, recipe import orphan-cache cleanup/large-file parse work from A–D2. No new implementation blocker.

## Changed files

- `PROJECT_CONTEXT.md`
- `apps/web/features/canvas/canvas-resize.test.ts`
- `apps/web/features/canvas/canvas-resize.ts`
- `apps/web/features/canvas/grid-flip-slot.test.tsx`
- `apps/web/features/canvas/grid-flip-slot.tsx`
- `apps/web/features/home/desktop-wallpaper.tsx`
- `apps/web/features/home/home-shell.css`
- `apps/web/features/home/mobile/mobile-shell.css`
- `apps/web/features/home/mobile/mobile-shell.test.tsx`
- `apps/web/features/home/scene/dawn-horizon.tsx`
- `apps/web/features/home/scene/scene-backdrop.test.tsx`
- `apps/web/features/home/scene/scene-backdrop.tsx`
- `apps/web/features/home/scene/use-scene-wallpaper.test.tsx`
- `apps/web/features/home/scene/use-scene-wallpaper.ts`
- `apps/web/features/home/settings-background.tsx`
- `apps/web/features/home/wallpaper.test.tsx`
- `apps/web/features/i18n/messages.ts`
- `docs/chris-features-receipt.md`
- `packages/domain/src/wallpaper.test.ts`
- `packages/domain/src/wallpaper.ts`
- `packages/ui/src/tokens.css`
