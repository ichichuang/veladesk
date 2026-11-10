# VelaDesk context

- Goal: full Veladesk redesign, with Dawn Chart as the adopted visual direction.
- Verified default branch: `main` (remote HEAD checked 2026-11-10); work directly in main, no branches or commits. Director delivers.
- Decisions: HeroUI v3; shared semantic/design tokens in `packages/ui`; GSAP owns scene/chrome motion, Motion owns snap FLIP. Free gestures track directly; reduced motion drops in place.
- RecipeV1 remains version 1 with optional, migratable fields. Recipe import/export slices A–D2 are complete.
- Delivered: per-desktop local IndexedDB wallpaper uploads and light/dark variants; preview/replace/delete; Dawn fallback, decoded crossfade and brightness scrim. Snap/free movement, eight resize handles, size steps, reflow, z-order and independently retained layouts.
- Active work: ready for Director review/delivery of the 2026-11-09 feature closeout: fallback/decode/boundary fixes and acceptance evidence (see `docs/chris-features-receipt.md`). No new dependencies.
- Remaining redesign work: Orbits/Wake experiments, stylesheet decomposition and wider device validation.
