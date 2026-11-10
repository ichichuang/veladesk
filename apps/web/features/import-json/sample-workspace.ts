/**
 * The built-in sample workspace (一键体验示例工作区).
 *
 * A fixed, curated example: four category sections («前端开发», «微信小程序»,
 * «AI 工具», «设计灵感») with two rows of curated websites each, one folder
 * example and a small dock. The builder REUSES the canonical JSON import
 * pipeline end-to-end — `parseImportDocument` → `planImport` →
 * `applyImportPlan` — so a sample workspace is byte-for-byte the same thing
 * a user would get importing the same JSON by hand: the same parser
 * normalization, the same planner dedupe, the same Add App placement and
 * icon policy. Folder and dock come from the ordinary domain editing ops
 * afterwards (the import v1 format deliberately has no folders/dock).
 *
 * The document content is static and shipped with the app: any failure here
 * is a programmer error, so the builder throws instead of inventing a
 * user-facing failure shape — the onboarding screen already renders thrown
 * errors through its own error state.
 */

import {
  DEFAULT_WORKSPACE_APPEARANCE,
  addAppToFolder,
  addFolderToPage,
  createEmptyWorkspace,
  deleteEmptyPage,
  pinEntityToDock,
  pageItemIds,
  withPageCanvas,
  materializePagePlacement,
} from "@veladesk/domain";
import type { Folder, WorkspaceSnapshot } from "@veladesk/domain";
import { createGridDefinition } from "@veladesk/desktop-engine";

import { translate, type TranslationKey } from "../i18n/messages";
import type { UiLocale } from "../i18n/locale";

import { applyImportPlan, resolveImportAppIcon } from "./apply-import";
import type { VelaDeskImportDocumentV1 } from "./contract";
import { IMPORT_FORMAT_IDENTITY, IMPORT_FORMAT_VERSION } from "./contract";
import { planImport } from "./planner";
import { parseImportDocument } from "./parser";

/** The sample workspace's display name. */
export const SAMPLE_WORKSPACE_NAME = "示例工作区";

/** The seed page exists only to bootstrap the import; it is removed after. */
const SAMPLE_SEED_PAGE_NAME = "开始";

/** Name of the section the folder example lives on. */
const SAMPLE_FOLDER_SECTION_NAME = "前端开发";

/** The folder example: a name plus apps that only exist inside the folder. */
const SAMPLE_FOLDER = {
  name: "框架文档",
  apps: [
    { name: "React 文档", url: "https://react.dev/learn" },
    { name: "Vue.js 指南", url: "https://cn.vuejs.org/guide/introduction.html" },
    { name: "TypeScript 手册", url: "https://www.typescriptlang.org/docs/handbook/intro.html" },
  ],
} as const;

/** Apps pinned to the sample dock, by exact app name from the document. */
const SAMPLE_DOCK_APP_NAMES = ["GitHub", "MDN", "ChatGPT", "Figma"] as const;

/**
 * The static sample import document. Every URL is a real, widely used,
 * long-term stable site; the app names inside one workspace are unique so
 * name-based lookups (folder/dock wiring below) are unambiguous.
 */
const SAMPLE_IMPORT_DOCUMENT: VelaDeskImportDocumentV1 = {
  format: IMPORT_FORMAT_IDENTITY,
  version: IMPORT_FORMAT_VERSION,
  sections: [
    {
      name: SAMPLE_FOLDER_SECTION_NAME,
      apps: [
        { name: "MDN", url: "https://developer.mozilla.org/", icon: "auto" },
        { name: "GitHub", url: "https://github.com", icon: "auto" },
        { name: "Stack", url: "https://stackoverflow.com", icon: "auto" },
        { name: "CSS", url: "https://web.dev/learn/css", icon: "auto" },
        { name: "React", url: "https://react.dev", icon: "auto" },
        { name: "Vue", url: "https://vuejs.org", icon: "auto" },
        { name: "TS", url: "https://www.typescriptlang.org", icon: "auto" },
        { name: "Vite", url: "https://vite.dev", icon: "auto" },
        { name: "npm", url: "https://www.npmjs.com", icon: "auto" },
      ],
    },
    {
      name: "微信小程序",
      apps: [
        {
          name: "微信开放文档",
          url: "https://developers.weixin.qq.com/miniprogram/dev/framework/",
          icon: "auto",
        },
        { name: "微信公众平台", url: "https://mp.weixin.qq.com", icon: "auto" },
        {
          name: "微信开放社区",
          url: "https://developers.weixin.qq.com/community/",
          icon: "auto",
        },
        {
          name: "开发者工具下载",
          url: "https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html",
          icon: "auto",
        },
        { name: "腾讯云", url: "https://cloud.tencent.com", icon: "auto" },
        { name: "小程序码", url: "https://cli.im", icon: "auto" },
        { name: "WeUI", url: "https://weui.io", icon: "auto" },
        {
          name: "TDesign 小程序",
          url: "https://tdesign.tencent.com/miniprogram/overview",
          icon: "auto",
        },
        {
          name: "微信云开发文档",
          url: "https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html",
          icon: "auto",
        },
        { name: "Vant", url: "https://vant-ui.github.io/vant-weapp/", icon: "auto" },
      ],
    },
    {
      name: "AI 工具",
      apps: [
        { name: "ChatGPT", url: "https://chatgpt.com", icon: "auto" },
        { name: "Claude", url: "https://claude.ai", icon: "auto" },
        { name: "DeepSeek", url: "https://chat.deepseek.com", icon: "auto" },
        { name: "通义千问", url: "https://tongyi.aliyun.com", icon: "auto" },
        { name: "文心一言", url: "https://yiyan.baidu.com", icon: "auto" },
        { name: "Hugging", url: "https://huggingface.co", icon: "auto" },
        { name: "Gemini", url: "https://gemini.google.com", icon: "auto" },
        { name: "Perplex", url: "https://www.perplexity.ai", icon: "auto" },
        { name: "OpenAI", url: "https://openai.com", icon: "auto" },
        { name: "Copilot", url: "https://github.com/features/copilot", icon: "auto" },
      ],
    },
    {
      name: "设计灵感",
      apps: [
        { name: "Figma", url: "https://www.figma.com", icon: "auto" },
        { name: "Dribbble", url: "https://dribbble.com", icon: "auto" },
        { name: "Behance", url: "https://www.behance.net", icon: "auto" },
        { name: "Canva", url: "https://www.canva.com", icon: "auto" },
        { name: "Unsplash", url: "https://unsplash.com", icon: "auto" },
        { name: "Iconfont", url: "https://www.iconfont.cn", icon: "auto" },
        { name: "Coolors", url: "https://coolors.co", icon: "auto" },
        { name: "Pexels", url: "https://www.pexels.com", icon: "auto" },
        { name: "Awwwards", url: "https://www.awwwards.com", icon: "auto" },
        { name: "站酷", url: "https://www.zcool.com.cn", icon: "auto" },
      ],
    },
  ],
};


/*
 * Sample icon glyphs (the Helm first picture, 2026-11-10): sample apps wear
 * their REAL monochrome brand glyphs from the bundled `simple-icons`
 * collection — on glass tiles, per visual-directions A — instead of the
 * retired solid-color blocks. Keyed by registrable-domain suffix (dot-
 * boundary match, any subdomain depth), so one entry covers the whole
 * brand host family; a couple of apps whose site has no icon map by NAME.
 * Everything unmapped keeps the refined initials badge. Every key below
 * exists in the bundled collection — a typo would degrade to the badge,
 * and the sample test asserts the mapped set.
 */
const SAMPLE_HOST_ICONS: Readonly<Record<string, string>> = {
  "developer.mozilla.org": "simple-icons:mdnwebdocs",
  "stackoverflow.com": "simple-icons:stackoverflow",
  "react.dev": "simple-icons:react",
  "vuejs.org": "simple-icons:vuedotjs",
  "typescriptlang.org": "simple-icons:typescript",
  "vite.dev": "simple-icons:vite",
  "npmjs.com": "simple-icons:npm",
  "weixin.qq.com": "simple-icons:wechat",
  "cloud.tencent.com": "simple-icons:tencentqq",
  "chatgpt.com": "simple-icons:openai",
  "claude.ai": "simple-icons:claude",
  "deepseek.com": "simple-icons:deepseek",
  "yiyan.baidu.com": "simple-icons:baidu",
  "huggingface.co": "simple-icons:huggingface",
  "gemini.google.com": "simple-icons:googlegemini",
  "perplexity.ai": "simple-icons:perplexity",
  "openai.com": "simple-icons:openai",
  "figma.com": "simple-icons:figma",
  "dribbble.com": "simple-icons:dribbble",
  "behance.net": "simple-icons:behance",
  "canva.com": "simple-icons:canva",
  "unsplash.com": "simple-icons:unsplash",
  "pexels.com": "simple-icons:pexels",
  "awwwards.com": "simple-icons:awwwards",
  "zcool.com.cn": "simple-icons:zcool",
  "slack.com": "simple-icons:slack",
  "notion.so": "simple-icons:notion",
  "meet.google.com": "simple-icons:googlemeet",
  "youtube.com": "simple-icons:youtube",
  "spotify.com": "simple-icons:spotify",
  "bilibili.com": "simple-icons:bilibili",
  "steampowered.com": "simple-icons:steam",
  "wikipedia.org": "simple-icons:wikipedia",
  "duolingo.com": "simple-icons:duolingo",
  "coursera.org": "simple-icons:coursera",
  "maps.google.com": "simple-icons:googlemaps",
};

/** By-name glyphs for sample apps whose HOST has no icon of its own. */
const SAMPLE_NAME_ICONS: Readonly<Record<string, string>> = {
  "CSS": "simple-icons:css3",
};

/** The bundled-brand icon for an app's URL (dot-boundary suffix match). */
function sampleIconForUrl(url: string): string | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
  for (const [domain, icon] of Object.entries(SAMPLE_HOST_ICONS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return icon;
    }
  }
  return undefined;
}

/**
 * The sample presentation pass (shared by the onboarding sample and the
 * compact templates): localize names and upgrade every app whose site maps
 * to a bundled brand glyph. Decoration stays AUTO — the Dawn Chart wash
 * plate composed from theme tokens; no per-app solid colors are forced.
 */
function applySamplePresentation(
  workspace: WorkspaceSnapshot,
  localize: (name: string) => string
): WorkspaceSnapshot {
  return {
    ...workspace,
    entities: workspace.entities.map((entity) => {
      if (entity.kind === "widget") {
        return entity;
      }
      const name = localize(entity.name);
      if (entity.kind !== "app") {
        return { ...entity, name };
      }
      const icon = sampleIconForUrl(entity.url) ?? SAMPLE_NAME_ICONS[entity.name];
      return icon === undefined
        ? { ...entity, name }
        : { ...entity, name, icon: { kind: "iconify", icon } };
    }),
  };
}

/** Kinds the sample builder needs fresh ids for. */
export type SampleIdKind = "workspace" | "page" | "app" | "folder";

/** Creates fresh ids at build time only (createBrowserId in production). */
export type SampleWorkspaceIdFactory = (kind: SampleIdKind) => string;

/**
 * Builds the complete sample workspace snapshot in memory: seed workspace →
 * canonical import pipeline (parse → plan → apply) → drop the empty seed
 * page → folder example → dock pins. Pure: no clocks, no storage, no
 * network; all ids come from the injected factory.
 */
export function buildSampleWorkspace(idFactory: SampleWorkspaceIdFactory, locale: UiLocale = "zh-CN"): WorkspaceSnapshot {
  const localizedNames: Readonly<Record<string, TranslationKey>> = {
    "前端开发": "sample.frontend", "微信小程序": "sample.wechat", "AI 工具": "sample.ai",
    "设计灵感": "sample.design", "框架文档": "sample.frameworkDocs", "React 文档": "sample.reactDocs",
    "Vue.js 指南": "sample.vueGuide", "TypeScript 手册": "sample.typescriptHandbook",
    "微信开放文档": "sample.wechatDocs", "微信公众平台": "sample.wechatPlatform",
    "微信开放社区": "sample.wechatCommunity", "开发者工具下载": "sample.devtools",
    "TDesign 小程序": "sample.tdesign", "微信云开发文档": "sample.cloudDocs",
    "腾讯云": "sample.tencentCloud", "小程序码": "sample.qrCode",
    "通义千问": "sample.qwen", "文心一言": "sample.ernie", "站酷": "sample.zcool",
  };
  const localize = (name: string) => localizedNames[name] === undefined ? name : translate(locale, localizedNames[name]);
  const seedPageId = idFactory("page");
  let workspace = createEmptyWorkspace({
    workspaceId: idFactory("workspace"),
    workspaceName: translate(locale, "sample.workspaceName"),
    pageId: seedPageId,
    pageName: SAMPLE_SEED_PAGE_NAME,
    grid: createGridDefinition(10, 6),
  });

  // The canonical import pipeline — the SAME path the JSON import dialog
  // uses, so sample data exercises exactly the shipped import semantics.
  const parsed = parseImportDocument(JSON.stringify(SAMPLE_IMPORT_DOCUMENT));
  if (!parsed.ok) {
    throw new Error("the built-in sample import document must always parse");
  }
  const plan = planImport(workspace, parsed.parsed.document, parsed.parsed.issues);
  const applied = applyImportPlan(workspace, plan, (kind) => idFactory(kind));
  if (!applied.ok) {
    throw new Error(`the sample import must always apply cleanly (reason: ${applied.reason})`);
  }
  workspace = applied.workspace;

  // The seed page was only the import's grid source; the sample workspace
  // is exactly the four category sections.
  const seeded = deleteEmptyPage(workspace, seedPageId);
  if (seeded.ok) {
    workspace = seeded.workspace;
  }

  // Folder example: created EMPTY (domain rule), then filled with the
  // ordinary add-to-folder op. Lives on «前端开发».
  const folderSection = workspace.pages.find((page) => page.name === SAMPLE_FOLDER_SECTION_NAME);
  if (folderSection !== undefined) {
    const folderId = idFactory("folder");
    const created = addFolderToPage(workspace, folderSection.id, {
      kind: "folder",
      id: folderId,
      name: SAMPLE_FOLDER.name,
      children: [],
    });
    if (created.ok) {
      workspace = created.workspace;
      for (const sampleApp of SAMPLE_FOLDER.apps) {
        const added = addAppToFolder(workspace, folderId, {
          kind: "app",
          id: idFactory("app"),
          name: sampleApp.name,
          url: sampleApp.url,
          icon: resolveImportAppIcon(sampleApp.name, sampleApp.url),
          openMode: "new-tab",
          tags: [],
        });
        if (added.ok) {
          workspace = added.workspace;
        }
      }
    }
  }

  // Dock: pin the curated apps. Entities may live on a page AND be docked.
  for (const appName of SAMPLE_DOCK_APP_NAMES) {
    const app = workspace.entities.find(
      (entity): entity is Extract<typeof entity, { kind: "app" }> =>
        entity.kind === "app" && entity.name === appName
    );
    if (app !== undefined) {
      const pinned = pinEntityToDock(workspace, app.id);
      if (pinned.ok) {
        workspace = pinned.workspace;
      }
    }
  }

  // Apply presentation after folder/dock wiring; entity ids stay unchanged.
  return applySamplePresentation({
    ...workspace,
    pages: workspace.pages.map((page) => {
      // Use the canonical canvas API so both desktop and mobile read one layout.
      const ids = [...pageItemIds(page)];
      const folderIndex = ids.findIndex((id) => workspace.entities.some((entity) => entity.id === id && entity.kind === "folder"));
      if (folderIndex > 0) ids.unshift(...ids.splice(folderIndex, 1));
      return {
        ...withPageCanvas(materializePagePlacement(page), {
          version: 2, mode: "grid", columns: 5,
          items: ids.map((id, index) => ({ id, column: index % 5, row: Math.floor(index / 5), columnSpan: 1, rowSpan: 1 })),
        }),
        name: localize(page.name),
      };
    }),
  }, localize);
}

/** The sample folder, exposed for tests/UI copy (null while absent). */
export function findSampleFolder(
  workspace: WorkspaceSnapshot
): Folder | undefined {
  return workspace.entities.find(
    (entity): entity is Folder => entity.kind === "folder" && [SAMPLE_FOLDER.name, translate("en-US", "sample.frameworkDocs")].includes(entity.name)
  );
}

export type WorkspaceTemplate = "blank" | "frontend" | "work" | "home";

/** Compact curated desks share the import, placement and contrast policy of
 * the onboarding sample; no uploaded assets or network requests are needed. */
export function buildWorkspaceTemplate(template: WorkspaceTemplate, idFactory: SampleWorkspaceIdFactory, locale: UiLocale): WorkspaceSnapshot {
  if (template === "frontend") return buildSampleWorkspace(idFactory, locale);
  const seed = idFactory("page");
  let workspace = createEmptyWorkspace({ workspaceId: idFactory("workspace"), workspaceName: translate(locale, "workspace.defaultName", { number: 1 }), pageId: seed, pageName: translate(locale, "workspace.section.start"), grid: createGridDefinition(5, 6) });
  if (template === "blank") return workspace;
  const work = template === "work";
  const sections = work ? [
    { name: translate(locale, "workspace.section.collaboration"), apps: [
      { name: "Slack", url: "https://slack.com" },
      { name: "Notion", url: "https://www.notion.so" },
      { name: "Figma", url: "https://www.figma.com" },
      { name: "Meet", url: "https://meet.google.com" },
    ] },
    { name: translate(locale, "workspace.section.development"), apps: [
      { name: "GitHub", url: "https://github.com" },
      { name: "MDN", url: "https://developer.mozilla.org" },
      { name: "TS", url: "https://www.typescriptlang.org" },
      { name: "Vite", url: "https://vite.dev" },
    ] },
  ] : [
    { name: translate(locale, "workspace.section.entertainment"), apps: [
      { name: "YouTube", url: "https://www.youtube.com" },
      { name: "Spotify", url: "https://open.spotify.com" },
      { name: "Bilibili", url: "https://www.bilibili.com" },
      { name: "Steam", url: "https://store.steampowered.com" },
    ] },
    { name: translate(locale, "workspace.section.learning"), apps: [
      { name: "Wiki", url: "https://www.wikipedia.org" },
      { name: "Duolingo", url: "https://www.duolingo.com" },
      { name: "Coursera", url: "https://www.coursera.org" },
      { name: "Maps", url: "https://maps.google.com" },
    ] },
  ];
  const parsed = parseImportDocument(JSON.stringify({ format: IMPORT_FORMAT_IDENTITY, version: IMPORT_FORMAT_VERSION, sections }));
  if (!parsed.ok) throw new Error("Invalid built-in workspace template");
  const applied = applyImportPlan(workspace, planImport(workspace, parsed.parsed.document, parsed.parsed.issues), kind => idFactory(kind));
  if (!applied.ok) throw new Error("Could not apply built-in workspace template");
  workspace = applied.workspace;
  const deleted = deleteEmptyPage(workspace, seed);
  if (deleted.ok) workspace = deleted.workspace;
  return applySamplePresentation({ ...workspace, preferences: { ...workspace.preferences, appearance: {
    ...DEFAULT_WORKSPACE_APPEARANCE,
    // Both templates are the dark dawn chart first picture; they differ by
    // hue, not by a forced mode — the user can pick light/system in Settings.
    wallpaperPreset: work ? "midnight" : "dawn",
    accentHue: work ? 205 : 60,
    interfaceStyle: "glass",
  } }, pages: workspace.pages.map(page => withPageCanvas(materializePagePlacement(page), {
    version: 2, mode: "grid", columns: 5, items: pageItemIds(page).map((id, index) => ({ id, column: index % 5, row: Math.floor(index / 5), columnSpan: 1, rowSpan: 1 })),
  })) }, (name) => name);
}
