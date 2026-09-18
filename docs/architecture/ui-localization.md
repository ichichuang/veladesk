# UI Localization (zh-CN / en-US)

## Purpose

Task 014-D gives the production UI a bilingual foundation: Simplified
Chinese is the product default, English is switchable, and the switch is a
browser-local preference. Task 014-E makes Chinese-first verifiable in
real browsers (the v2 storage reset) and exposes a compact 中/EN switch in
the top bar. No i18n package is used — the whole layer is a few small
modules under `apps/web/features/i18n/`.

## Scope

Production `/` is fully bilingual: boot, onboarding, workspace picker,
recovery screens, the desktop shell top bar, sync indicator, dock,
selection count, context menus, all dialogs, the folder overlay, the
launcher (UI, command labels, keyword metadata) and the Settings Center.
The engineering labs (`/lab/desktop`, `/lab/workspace-runtime`) stay
English and must keep working.

User-generated data is never translated: workspace names, app names,
folder names, page names, URLs and tags render verbatim in every locale.

## Locales and the default

`UiLocale` is exactly `"zh-CN" | "en-US"`, with `DEFAULT_UI_LOCALE =
"zh-CN"`. The first visit is Chinese — the locale is deliberately NOT
inferred from `navigator.language`; switching is an explicit user action
(the topbar 中/EN switch or Settings → General). Anything unparsable or
unsupported falls back to zh-CN (`parseUiLocale`).

## Browser-local persistence, never workspace data

The UI language is a per-browser preference stored under the localStorage
key `veladesk.ui-locale.v2` (014-E). The v1 key is dead: it may hold
`en-US` in real browser profiles polluted during development/automation,
so it is never read and never migrated. When v2 is absent the locale is
unconditionally zh-CN — a language choice only exists once explicitly
written to v2. Switching languages:

- does not stage the workspace,
- does not bump `localGeneration`,
- does not enqueue an outbox entry,
- does not fire any workspace HTTP mutation.

There is no locale field in the domain schema, no SQLite migration and no
Dexie migration. The Settings draft model structurally cannot become dirty
from a language switch — `WorkspaceSettingsDraft` has no locale field
(pinned by `features/i18n/locale-isolation.test.ts`). The Settings General
section applies the language immediately (no Save step) and the Save
button state is unaffected.

`readStoredUiLocale` / `persistUiLocale` wrap every storage access in
try/catch: a blocked or unavailable localStorage never crashes the app —
the default locale wins and persistence is silently skipped.

## SSR / hydration strategy

The root layout renders `<html lang="zh-CN" suppressHydrationWarning>`
(server locale is forbidden by design). `UiLocaleProvider` binds the
locale through `useSyncExternalStore`:

- `getServerSnapshot` (used for the server render AND the hydration
  render) always returns zh-CN, so the first client frame matches the
  server frame — no hydration mismatch, ever;
- after hydration React switches to the client snapshot, which lazily
  restores the stored locale, so a stored en-US applies one render later;
- a `useEffect` keeps `document.documentElement.lang` in sync
  (`zh-CN` / `en-US`).

Switching locale updates the module-scope store, persists immediately and
notifies subscribers; the app-wide locale is singleton state, which is
exactly the shape `useSyncExternalStore` models.

## Typed catalogs

`messages.ts` holds two static dictionaries. The zh-CN literal is the key
source of truth: `TranslationKey = keyof typeof zhCNCatalog`, and the
English catalog is typed `Record<TranslationKey, string>` — a missing or
extra English key is a compile-time error. A mixed-language Chinese UI
(missing key falling back to English) is therefore impossible by
construction; test-time parity (`Object.keys` equality) re-verifies it.

Interpolation is a minimal `{param}` formatter (`format-message.ts`):
`{count}`, `{name}`, `{revision}`-style placeholders are replaced with
string/number values; a placeholder without a matching parameter stays
literal so missing values stay visible. No ICU.

## New-workspace defaults

Onboarding seeds locale-aware defaults for newly created workspaces:
workspace name `我的 VelaDesk` / `My VelaDesk`, first page `主页` /
`Home`. This affects new workspaces only — existing pages are never
renamed.

## Launcher localization

`buildLauncherEntries` takes the active `locale` and resolves command
labels from the same catalogs (`launcher.command.*` keys). Search
metadata (secondary keywords) is bilingual in both locales, so Settings
is findable via 设置, "settings" or "theme", and the sync command via
同步 or "sync". Entry labels for apps/folders/pages remain user data.

## Where things live

| Piece                    | Module                                    |
| ------------------------ | ----------------------------------------- |
| Locale type/parsing/storage | `features/i18n/locale.ts`              |
| Typed catalogs + translate | `features/i18n/messages.ts`             |
| `{param}` interpolation  | `features/i18n/format-message.ts`         |
| Provider (external store) | `features/i18n/ui-locale-provider.tsx`   |
| Consumer hook (`t`, `setLocale`) | `features/i18n/use-i18n.ts`       |
| Topbar switch model | `features/i18n/locale-switch.ts`            |
| Topbar switch component | `features/home/locale-switch.tsx`        |

The Settings Center's General section (界面语言 / Interface language)
renders the two endonym labels — 中文 and English — in every locale, with
a hint explaining that the language is browser-local only. The topbar's
compact 中/EN switch (`buildLocaleSwitchButtons`) writes the exact same
UiLocale store — one source of truth, two entry points.
