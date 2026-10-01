# VelaDesk GSAP Motion System (task 022)

Production animation ownership is **GSAP only** (`gsap` 3.15.0 +
`@gsap/react` 2.1.2, pinned exact). Motion (`motion` 13.4.0), the
framer-motion/motion-dom/motion-utils lockfile entries, the browser-native
WAAPI comparison driver and the engine-selection UI are REMOVED. HeroUI,
React Aria and Radix keep ownership of controls, semantics, focus,
dismissal and positioning; GSAP owns interpolated visuals. dnd-kit and the
geometry engines keep drag/resize/snap ownership. Workspace data,
placement semantics, smart recognition, assets and persistence are
untouched.

This ledger maps every product surface to its behavior owner, positioning
owner, animation target, GSAP component and tests.

## Ownership rules

- **Requested state** — React state (open flags, selections, values).
  Business state changes immediately; GSAP interpolates from the current
  visual state and never delays a value.
- **Presence** — `useVdPresence` (components/vd/presence.ts): requested
  `open` vs. mounted presence (render-phase prop-derived mount; release
  only through `completeExit()` from the exit tween's completion — an
  animation callback, never render). Exactly-one release per exit;
  reopening mid-exit retargets, never unmounts.
- **Interpolated visuals** — GSAP timelines/tweens created through the
  shared entry (`components/vd/gsap.ts`), typed presets
  (`components/vd/motion-tokens.ts`), one animation owner per property per
  node.
- **Positioning** — Radix (`radix-ui`) for popovers/selects/tooltips/dialog
  portals; the portaled/fixed element is an OUTER positioning node. GSAP
  animates an INNER surface node (`VdAnimatedSurface`) and never writes a
  positioning transform (`translate(-50%,-50%)`, floating-ui placement).
- **Drag / resize / snap** — dnd-kit + canvas/square-grid engines. GSAP
  animates decoration-only feedback on other nodes (inner hover-lift
  nodes); it never writes a drag transform or layout coordinate.
- **Reduced motion** — shared bridge (`components/vd/reduced-motion.ts`,
  `prefers-reduced-motion: reduce` via live matchMedia): product state
  settles immediately, stale completions are invalidated (generation bump
  + timeline kill in the shell), and a preference flip mid-transition
  settles the machine without losing focus. CSS
  `@media (prefers-reduced-motion: reduce)` rules remain as the
  pre-hydration belt (duration/iteration guards only).

## Preset module

`apps/web/components/vd/motion-tokens.ts` — seconds, base easing
`power2.out`, no bounce/elastic overshoot (the ambient wallpaper yoyo is
the one deliberate exception: `sine.inOut` — a symmetric loop):

| Preset         | Seconds | Used by                                            |
| -------------- | ------- | -------------------------------------------------- |
| `hoverPress`   | 0.16    | press scale, desktop tile / dock hover lift, checkbox pop, grid guides fade |
| `controlState` | 0.22    | switch thumb travel                                |
| `tooltip`      | 0.18    | VdTooltip entrance                                 |
| `popup`        | 0.24    | popovers, selects, color picker, context menu, launcher/recognition/icon-picker windows |
| `tabContent`   | 0.26    | settings section pane                              |
| `indicator`    | 0.28    | rail active indicator                              |
| `dialog`       | 0.34    | dialog window entrance (exit ×0.75)                |
| `inspector`    | 0.38    | right-side inspector panel (exit ×0.75)            |
| `sectionPage`  | 0.50    | section page slide (the pair timeline)             |

Tooltip INTENT delay stays `VD_TOOLTIP_OPEN_DELAY_MS = 220` (semantics,
not animation). URL-recognition debounce and wheel intent thresholds are
not animation durations and were not touched. The `--vd-motion-*` CSS
custom properties remain defined in the token layer but NO CSS rule
animates with them anymore.

## Shared GSAP component layer (`apps/web/components/vd/`)

| Component / module      | Responsibility |
| ----------------------- | -------------- |
| `gsap.ts`               | The ONE client entry: registers `useGSAP` once; re-exports `gsap`. No server recognition/DNS/asset/domain package imports it. |
| `motion-tokens.ts`      | Preset table + shared ease. |
| `reduced-motion.ts`     | `useVdReducedMotion()` hook + `vdPrefersReducedMotion()` getter (live matchMedia, SSR-safe). |
| `presence.ts`           | `useVdPresence(open)`: requested vs. mounted presence; render-phase mount; `completeExit()` releases exactly once from the exit tween's callback. |
| `animated-surface.tsx`  | `VdAnimatedSurface` (presence enter/exit; variants overlay/dialog/panel/popup/tooltip/launcher/recognition) and `VdPopupSurface` (entrance-only for library-unmount surfaces). Hidden pose committed synchronously on fresh mount; retargetable `.to()` tweens; pointer-inert + `inert` during exit. |
| `press-feedback.tsx`    | `VdPressFeedback`: inner-span press scale 0.97; one owned retargetable tween; hit geometry stable. |
| `animated-indicator.tsx`| `VdAnimatedIndicator`: resolver-based rail marker; one-shot offsetTop/offsetHeight measurement per activation; first placement without sweep. |
| `hover-lift.tsx`        | `useVdHoverLift`: decorative lift tween on an inner node (desktop tiles view-mode, dock icons); stable callbacks, no render-time ref access. |
| `loading-indicator.tsx` | `VdLoadingIndicator`: owned infinite rotation (rAF ticker; stops when hidden/pending-off/unmounted); static under reduced motion. |
| `ambient-drift.ts`      | `useVdAmbientDrift`: infinite yoyo drift for the real ambient nodes (boot screen + desktop). |
| `switch.tsx`            | `VdSwitch` composition unchanged (HeroUI Switch.Content wrapper); thumb travel GSAP-tweened from previous visual position; HeroUI slot CSS transitions disabled via the scoped `[data-vd-switch-gsap]` override in `vd-ui.css`. |

## Section navigation (milestone 2 core)

- Pure machine (`section-transition-machine.ts`): idle / prepared /
  transition + `pendingId` — the bounded latest-third-target policy. A
  third destination during motion parks (never a third painter, never a
  queue); the newest pending wins; a reversal inside the visible pair
  supersedes any pending target; the parked request starts immediately at
  settle (no added delay). `pendingExits` (021-R1) is deleted — a
  preparation is only ever requested from idle/another preparation.
- GSAP pair coordinator (`section-pair-animator.ts`): ONE timeline per
  visible-page pair; both layers are tweens at position 0 (one shared
  playhead — complementary positions meeting at a moving viewport
  boundary). Fresh next-page: outgoing y 0→−H, incoming +H→0 (prev
  mirrors; H = measured section viewport height, never content height).
  Wrapper opacity stays 1 — no crossfade. Reversal retargets from current
  y (kill preserves the interrupted pose; `enter-from` only on fresh
  entries, committed in the layout phase pre-paint). Same-generation
  re-applies skip. One generation-guarded completion per transition;
  `settleAll()` rests layers through the same GSAP owner. Non-participants
  rest when a new pair takes over.
- Shell (`desktop-shell.tsx`): layer registration callbacks; pair-command
  layout effect; pair-settle → machine idle → warm-set rotation → pending
  continuation; instant/reduced-motion/prune paths call `settleAll()`;
  coordinator disposed on unmount. Scroller identity, warm-cache bounds
  (±1), scroll memory and stable keys are unchanged.

## Coverage ledger

Legend — **Status**: ✅ GSAP is the only animation owner · 🔶 entrance
GSAP-owned, close = library/shell unmount (no exit animation exists — same
as pre-022; documented honestly) · 🚫 no animation (static state change,
by design).

| Surface | Behavior / semantics owner | Positioning owner | Animated target + properties | GSAP component | Status | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Section category page slide (next/prev) | section-transition-machine + shell | `.vela-section-viewport` (static clip box) | page wrapper `y` only, opacity 1; one shared timeline | `createSectionPairCoordinator` | ✅ | `section-pair-animator.test.tsx` (13) |
| Section interruption (reversal / same-command / newer generation / teardown) | coordinator + machine | same | kill-preserves-pose retarget; skip; guarded completion | same | ✅ | `section-pair-animator.test.tsx` |
| Third destination during motion | machine `pendingId` (bounded latest) | same | pair runs to boundary; pending starts at settle | machine + shell | ✅ | `section-transition-machine.test.ts` (30) |
| Cold destination (prepared → armed) | machine + shell arm frame | same | mounts hidden, arms after layout pass | machine | ✅ | `section-transition-machine.test.ts` |
| Rail active indicator | rail roving tabindex / aria-current | rail list (static, relative) | indicator `top`/`height`/opacity | `VdAnimatedIndicator` | ✅ | `interaction.test.tsx`, `section-rail` via contracts |
| Settings nav selection | buttons, aria-selected | static | none — instant state | — | 🚫 | `settings-center.test.ts` |
| Settings tab content switch | SettingsCenter state | static pane | pane `x ±8`/opacity, direction-aware | inline `gsap.fromTo` on `tabContent` | ✅ (enter; business state immediate) | `settings-center.test.ts` |
| Settings window enter/exit | Radix Dialog | Radix portal; outer fixed node | inner surface `opacity/y/scale`; scrim opacity; open-driven presence (exit + reopen retarget; draft re-init on open) | `VdAnimatedSurface` dialog + overlay | ✅ | `settings-theme-boundary.test.tsx` |
| App Inspector panel (right) | Radix Dialog panel variant | Radix portal; fixed right anchor | inner surface `opacity/x 24→0`; open-driven; never resizes desktop | `VdAnimatedSurface` panel | ✅ | `app-appearance-inspector.test.tsx`, `app-appearance-switch-chain.test.tsx` |
| Add/Edit App, section/folder/move forms (`VdFormDialog`) | Radix Dialog + native form | Radix portal; outer node | inner surface `opacity/y 8/scale .985` | `VdAnimatedSurface` dialog | 🔶 (shell unmounts on close — pre-022 behavior kept) | form/dialog render checks |
| Confirmations (`ConfirmDialog`/`AlertDialog`) | Radix AlertDialog | Radix portal; outer node | inner surface `opacity/y/scale` | `VdAnimatedSurface` dialog | 🔶 (same as above) | render checks |
| Launcher | shell combobox model | fixed backdrop (surface child) | backdrop opacity + panel `opacity/y/scale`; open-driven presence; focus restore once at release; query reset per open | `VdAnimatedSurface` launcher + overlay | ✅ | `launcher-ui.test.ts` |
| Folder overlay | shell folder actions | fixed backdrop (surface child) | backdrop opacity + panel `opacity/y/scale`; open-driven; last-folder mirror keeps real content through exit | `VdAnimatedSurface` launcher + overlay | ✅ | `home-shell-css.test.ts` (structure) |
| Icon picker secondary windows | Radix Dialog | Radix portal | inner surface (popup band) | `VdAnimatedSurface` dialog+`motionPreset="picker"` | 🔶 | inspector chain tests |
| Color picker popover (`ColorField`) | Radix Popover | Radix floating node | inner surface `opacity/y 4` | `VdPopupSurface` | ✅ (entrance; Radix unmount close) | render checks |
| Select popup (Radix Select) | Radix Select | Radix popper node | inner surface `opacity/y 4` (CSS `vdu-pop-in` removed) | `VdPopupSurface` | ✅ (entrance) | `settings-theme-boundary.test.tsx` |
| Popover (generic) | Radix Popover | Radix floating node | inner surface `opacity/y 4` | `VdPopupSurface` | ✅ (entrance) | render checks |
| Tooltip (`VdTooltip`) | Radix Tooltip (intent 220 ms unchanged) | Radix floating node | inner surface `opacity/y 4` (CSS `vd-tooltip-in` removed) | `VdPopupSurface` tooltip | ✅ (entrance) | dock contracts |
| Context menu | shell menu model (keyboard, clamp, Escape) | fixed, clamped | surface `opacity/scale .98/y −2` entrance (CSS `vela-menu-in` removed) | inline `gsap.fromTo` popup band | ✅ (entrance; unmount close) | `context-menu-position.test.ts` |
| Recognition status (Add App) | smart-add reducer | in-dialog flow | panel `opacity/y 4` presence enter/exit | `VdAnimatedSurface` recognition | ✅ | `add-app-dialog` checks |
| Recognition spinner | pending state | static | owned rotation tween | `VdLoadingIndicator` | ✅ | `interaction.test.tsx` |
| Buttons (designed Button) | native button | static | press: inner `VdPressFeedback` scale .97; hover colors instant (CSS transitions removed) | `VdPressFeedback` | ✅ | `interaction.test.tsx` |
| Desktop tile hover lift (view mode) | decorative | static | inner `.vela-item__body` `y −2` (CSS rule removed; arrange never lifts) | `useVdHoverLift` | ✅ | `home-shell-css.test.ts` |
| Dock hover lift + tooltips | decorative; spacing untouched | static | inner `.vela-dock__item-visual` `y −3` (CSS rule removed) | `useVdHoverLift` per item | ✅ | `dock.test.ts`, `home-shell-css.test.ts` |
| Switch (`VdSwitch`, HeroUI) | React Aria switch | static | thumb `x` travel from previous visual position; slot CSS transitions disabled (scoped `[data-vd-switch-gsap]` override); track colors instant | inline tween in `VdSwitch` | ✅ | `switch.test.ts` |
| Checkbox (Radix) | Radix Checkbox | static | check glyph scale .6→1 + fade on mount | `CheckGlyph` (inline `fromTo`) | ✅ | render checks |
| Collapsibles / disclosure chevrons | Radix Collapsible | static | no production consumer exists (component unused) | — | 🚫 (no consumer) | — |
| Icon-picker / wallpaper / style selection | selection state | static | none — static selected ring retained | — | 🚫 | — |
| Launcher rows / list selection | listbox semantics | static | none — active row is a static state change (no per-keystroke row animation) | — | 🚫 | `launcher-ui.test.ts` |
| Boot pulse (StartupScreen) | boot status | static | thumb `xPercent` sweep, owned infinite tween | inline tween + `VdLoadingIndicator`-style lifecycle | ✅ (CSS `vela-pulse` removed) | `interaction.test.tsx` pattern |
| Ambient wallpaper drift (boot + desktop) | decorative | static | real nodes `x%/y%/scale/opacity` yoyo (`sine.inOut`) | `useVdAmbientDrift` | ✅ (CSS `vela-ambient` + `::before` pseudo removed) | `home-shell-css.test.ts` (structure) |
| Grid guides fade | decorative | static | svg `opacity 0→.55` one-shot | inline `gsap.fromTo` in GridSlotOverlay | ✅ (CSS `vela-guides-in` removed) | `section-scroll-css.test.ts` |
| Sync status dot | static state | static | none (never animated) | — | 🚫 | — |
| Grid target feedback / drag / resize / marquee / dnd drop | dnd-kit + geometry engines | static | none — instant and exact (preserved) | — | 🚫 (preserved) | existing geometry suites |

### Exit-animation honesty (unchanged 🔶 set)

The shell conditionally mounts the small form/confirmation dialogs
(`VdFormDialog`, `ConfirmDialog`, the secondary picker windows), so a close
unmounts the subtree and no exit can play — exactly the pre-022 behavior.
Their entrances are GSAP-owned. Converting them to open-driven presence is
a mechanical follow-up (the `useVdPresence` + `VdAnimatedSurface` pattern
is proven on the four flagship surfaces) that was not required to meet
"GSAP is the only animation owner": no browser-native or Motion tween runs
on them either way.

## Deleted comparison / legacy paths (milestone 5, executed)

- `motion` dependency; `framer-motion`/`motion-dom`/`motion-utils` lockfile
  entries (verified 0 occurrences after `pnpm remove`).
- `MotionConfig`, `useReducedMotion` (motion), `AnimatePresence`,
  `motion.*`, `layoutId` — every import site migrated.
- `section-layer-animator.ts` (the Motion + WAAPI driver binding),
  `section-layer-animator.test.tsx`, `section-driver-comparison.test.tsx`.
- Driver-mode selection: `SectionDriverMode`, `setSectionDriverMode`,
  `getSectionDriverMode`, `resolveSectionDriverModeLabel`,
  `isNativeDriverAvailable`, the Settings engine toggle and the
  `driverMode` report fields/strings.
- The section-navigation diagnostics recorder and its Settings entry
  (021-R1/021-R3) were removed outright in 023-B.2 — no trace module,
  activation flag or recording window remains.
- CSS keyframes/rules: `vela-ambient`, `vela-pulse`, `vela-menu-in`,
  `vela-launcher-in`, `vela-fade`, `vela-rise`, `vela-guides-in`,
  `vd-tooltip-in`, `vdu-pop-in` usage, hover/press/item/dock `transition`
  rules, Tailwind `transition-*`/`duration-*` classes on migrated slots.
  Focus-visible outlines and reduced-motion guards retained.

## Non-owners (explicit)

- Browser caret, text selection, native scrolling (`VdScrollArea` keeps
  native scrolling with restyled scrollbars), `matchMedia`, Radix/HeroUI
  internal state machines.
- No ScrollSmoother, ScrollTrigger, Observer wheel capture, Draggable, or
  any GSAP plugin beyond core is used; no dynamic first-use import of
  GSAP; no per-frame React setState; no page-global target selectors; no
  `clearProps: "all"`; no global timeline reset; no ticker/lag-smoothing
  changes; `will-change` stays scoped to actively transitioning layers.
