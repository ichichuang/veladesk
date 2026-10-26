/**
 * The built-in sample workspace (一键体验示例工作区).
 *
 * A fixed, curated example: four category sections («前端开发», «微信小程序»,
 * «AI 工具», «设计灵感») with 6–8 real, long-lived websites each, one folder
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
  addAppToFolder,
  addFolderToPage,
  createEmptyWorkspace,
  deleteEmptyPage,
  pinEntityToDock,
} from "@veladesk/domain";
import type { Folder, WorkspaceSnapshot } from "@veladesk/domain";
import { createGridDefinition } from "@veladesk/desktop-engine";

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
const SAMPLE_DOCK_APP_NAMES = ["GitHub", "MDN Web Docs", "ChatGPT", "Figma"] as const;

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
        { name: "MDN Web Docs", url: "https://developer.mozilla.org/", icon: "auto" },
        { name: "GitHub", url: "https://github.com", icon: "auto" },
        { name: "Stack Overflow", url: "https://stackoverflow.com", icon: "auto" },
        { name: "React", url: "https://react.dev", icon: "auto" },
        { name: "Vue.js", url: "https://vuejs.org", icon: "auto" },
        { name: "TypeScript", url: "https://www.typescriptlang.org", icon: "auto" },
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
        { name: "Vant Weapp", url: "https://vant-ui.github.io/vant-weapp/", icon: "auto" },
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
        { name: "Hugging Face", url: "https://huggingface.co", icon: "auto" },
        { name: "OpenAI", url: "https://openai.com", icon: "auto" },
        { name: "GitHub Copilot", url: "https://github.com/features/copilot", icon: "auto" },
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
        { name: "站酷", url: "https://www.zcool.com.cn", icon: "auto" },
      ],
    },
  ],
};

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
export function buildSampleWorkspace(idFactory: SampleWorkspaceIdFactory): WorkspaceSnapshot {
  const seedPageId = idFactory("page");
  let workspace = createEmptyWorkspace({
    workspaceId: idFactory("workspace"),
    workspaceName: SAMPLE_WORKSPACE_NAME,
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

  return workspace;
}

/** The sample folder, exposed for tests/UI copy (null while absent). */
export function findSampleFolder(
  workspace: WorkspaceSnapshot
): Folder | undefined {
  return workspace.entities.find(
    (entity): entity is Folder => entity.kind === "folder" && entity.name === SAMPLE_FOLDER.name
  );
}
