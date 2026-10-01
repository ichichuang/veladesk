/**
 * The built-in AI organizing prompt (task 024 §6): the fixed instruction a
 * user pastes into any AI together with their website list so the output is
 * a valid VelaDesk Import JSON v1 document.
 */

import type { UiLocale } from "../i18n/locale";

const ZH_CN_PROMPT = `请把我提供的网站和应用整理成 VelaDesk Import JSON v1。

要求：

1. 只输出合法 JSON，不输出 Markdown 代码块，不解释。
2. 顶层必须严格包含：
   {
     "format": "veladesk-import",
     "version": 1,
     "sections": []
   }
3. 根据用途整理为合理的 sections。
4. 每个 section:
   {
     "name": "类别名称",
     "apps": []
   }
5. 每个应用:
   {
     "name": "简洁的应用名称",
     "url": "完整网址",
     "icon": "auto"
   }
6. 不生成任何 VelaDesk 内部 ID、位置、尺寸、Asset ID。
7. 同一个网址只保留一次。
8. 应用名称保持简洁，不使用完整 SEO 页面标题。
9. 保留我明确指定的类别名称和应用名称。
10. 无法判断类别时放入 "其他"。
11. 必须输出能够被 JSON.parse 直接解析的内容。`;

const EN_US_PROMPT = `Please organize the websites and apps I provide into VelaDesk Import JSON v1.

Requirements:

1. Output valid JSON only — no Markdown code blocks, no explanations.
2. The top level must be exactly:
   {
     "format": "veladesk-import",
     "version": 1,
     "sections": []
   }
3. Group the apps into sensible sections by purpose.
4. Each section:
   {
     "name": "Category name",
     "apps": []
   }
5. Each app:
   {
     "name": "Concise app name",
     "url": "Full URL",
     "icon": "auto"
   }
6. Do not generate any VelaDesk internal IDs, positions, sizes or asset IDs.
7. Keep each URL only once.
8. Keep app names concise; do not use full SEO page titles.
9. Keep the category names and app names I explicitly specified.
10. When the category is unclear, use "其他" (Other).
11. The output must be directly parseable by JSON.parse.`;

export function buildImportAiPrompt(locale: UiLocale): string {
  return locale === "en-US" ? EN_US_PROMPT : ZH_CN_PROMPT;
}
