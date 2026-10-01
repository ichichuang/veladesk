# VelaDesk Import JSON v1

## Responsibility

Task 024 adds an **AI/human-friendly bulk import format** for sections
(categories) and web apps: hand any website list to an AI, get a small JSON
document back, and VelaDesk turns it into a fully placed desktop — previewed
first, written in ONE workspace revision.

| Owns | Never touches |
| --- | --- |
| the public `veladesk-import` v1 contract | internal ids, grid/freeform coordinates, spans |
| parse → validate → plan → preview → confirm pipeline | appearance, wallpaper, dock, folders |
| duplicate detection by canonical URL key | renaming/moving existing apps |
| offline icon resolution (brand catalog → generated text) | network fetches of imported URLs |

The format is **intentionally independent from `WorkspaceSnapshot`** so the
internal model can evolve without breaking AI-generated documents.

## The product model (three separate jobs)

| Concept | Purpose |
| --- | --- |
| **VelaDesk Import JSON** (this feature) | turn a name+url+category list into sections and apps |
| **VelaDesk Smart Recognition** (task 020-A) | recognize ONE site's name/icon via a safe server fetch |
| **VelaDesk Backup / Restore** (future) | full workspace fidelity — NOT this format |

The import format must never grow into a backup format: it deliberately
carries no entity ids, revision, placement, assets or view state.

## Layers

| Layer | File | Owns |
| --- | --- | --- |
| contract | `apps/web/features/import-json/contract.ts` | public types, issue codes, limits |
| normalization | `apps/web/features/import-json/normalization.ts` | name keys (NFKC/collapse/lower), canonical URL keys, Add-App URL acceptance |
| parser | `apps/web/features/import-json/parser.ts` | `JSON.parse` + schema validation → structured issues |
| planner | `apps/web/features/import-json/planner.ts` | pure create/merge/skip plan against a snapshot |
| apply | `apps/web/features/import-json/apply-import.ts` | in-memory snapshot construction via `addPage`/`addAppToPage` |
| template + prompt | `template.ts`, `ai-prompt.ts`, `clipboard.ts` | the canonical download, the built-in AI prompt |
| UI | `import-json-dialog.tsx` + Settings → General → Data | upload/paste → preview → confirm → done |
| brand aliases | `apps/web/features/app-recognition/brand-aliases.ts` | the shared (client-safe) hostname → icon table |

## The exact v1 template

The downloadable file is generated from ONE canonical constant
(`VELA_IMPORT_TEMPLATE_V1` in `template.ts`); this document must match it
(a contract test pins the drift):

```json
{
  "format": "veladesk-import",
  "version": 1,
  "sections": [
    {
      "name": "办公",
      "apps": [
        {
          "name": "GitHub",
          "url": "https://github.com/",
          "icon": "auto"
        },
        {
          "name": "Notion",
          "url": "https://www.notion.so/",
          "icon": "auto"
        }
      ]
    },
    {
      "name": "AI",
      "apps": [
        {
          "name": "ChatGPT",
          "url": "https://chatgpt.com/",
          "icon": "auto"
        }
      ]
    }
  ]
}
```

Download filename: `veladesk-import-v1.json` (UTF-8, `JSON.stringify` with
2-space indent).

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | must be exactly `"veladesk-import"` |
| `version` | yes | must be exactly `1` (higher → `UNSUPPORTED_VERSION`, never best-effort) |
| `sections` | yes | array of sections to create/merge |
| `sections[].name` | yes | display name; NFKC/trim/collapse for comparison, first spelling wins |
| `sections[].apps` | yes | may be empty (structure-first imports are legal) |
| `apps[].name` | yes | concise display name |
| `apps[].url` | yes | same acceptance rule as ordinary Add App |
| `apps[].icon` | no | only `"auto"` is valid; omitted ≡ `"auto"` |

VelaDesk generates **ids, layout placement, icon presentation and open
behavior** at import time. Users/AI must never provide internal fields
(`id`, `assetId`, coordinates, spans…): unknown fields are shown as
`UNSUPPORTED_FIELD_IGNORED` warnings and ignored — never silently honored,
never fatal by themselves.

## URL rules

- Acceptance matches ordinary Add App exactly: non-blank, ≤ 2048 chars;
  recognizable input is stored in normalized `https://` form, custom
  protocols (`obsidian://`, `steam://`, …) stay verbatim (trimmed).
- The Smart-Recognition SSRF/public-host gate is deliberately NOT the
  validator — intranet tools (`http://wiki.internal/`) import fine.
- Duplicate key (`canonicalImportUrlKey`): scheme/hostname casing, default
  ports, root-slash and fragment are normalized away; path and query order
  are significant.
- Import performs **zero network requests** — no favicon fetches, no
  recognition API calls, works offline.

## Merge and duplicate semantics

| Situation | Result |
| --- | --- |
| section name key matches exactly one existing section | **merge** into it |
| no existing match | **create** (New Section construction defaults) |
| two or more existing matches | `AMBIGUOUS_EXISTING_SECTION` error — the plan is blocked |
| duplicate sections inside one document | merged into the first occurrence (warning) |
| app URL already anywhere in the workspace | skipped with `DUPLICATE_WORKSPACE_APP` (existing app untouched) |
| duplicate URL inside one document | first occurrence wins (warning) |
| same name, different URL | distinct apps — URL identity controls duplication |
| empty section | created as an empty section |

The import is **additive only**: existing sections/apps absent from the
document are always kept. There is no replace/overwrite mode in v1.

## Icon policy

`icon: "auto"` (or omitted) → the LOCAL brand table
(`brand-aliases.ts`, e.g. `github.com` → `simple-icons:github`) resolves
offline; unmatched apps get the shared generated-text helper
(`generatedIconText`: first two code points, uppercased). No second
initials algorithm, no remote URLs.

## Placement

The JSON never carries geometry. Apply chains the ordinary domain ops
(`addPage` with the SectionDialog construction, then `addAppToPage` per
app) so each imported app lands on the next free slot via the shared
placement engine — imported apps see previously imported apps.

## Limits (v1 defaults; no stricter project limits exist)

| Limit | Value |
| --- | --- |
| JSON text | 1 MiB (files checked by `size` BEFORE reading; paste by length) |
| sections per import | 100 |
| apps per import | 2000 (total) |
| section name | 80 chars (the New Section dialog cap) |
| app name | 80 chars (the Add App dialog cap) |
| URL | 2048 chars (the Add App cap) |

## Transaction shape

Parse → validate → plan → preview perform **zero writes**. The confirmed
Import re-derives the plan from the CURRENT snapshot; if the workspace
changed materially since the preview (`plansMateriallyEqual`), the preview
updates and requires a second confirmation instead of writing. The write
itself is one `stageWorkspaceAndTrySync` call: one local generation, one
server revision, never one revision per app.

## Built-in AI prompt

Settings → General → Data exposes **Copy AI prompt**; the zh-CN / en-US
texts live in `ai-prompt.ts` and instruct the AI to output only
`JSON.parse`-able content with the exact top-level shape, concise names,
deduplicated URLs, no internal fields, and `"其他"` (Other) for unclear
categories.

## Versioning policy

Version 1 is immutable in meaning. Incompatible changes ship as
`version: 2` with a new parser path; v1 documents must keep importing
unchanged forever. Unknown HIGHER versions are hard-rejected
(`UNSUPPORTED_VERSION`) — never "best effort" parsed.

## Non-goals

- No workspace export, no backup/restore.
- No grid coordinates, spans, iconScale/labelScale, colors, decorations.
- No dock membership, folders, wallpaper or view-state import.
- No deleting or replacing existing content.
