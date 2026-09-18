import type { UiLocale } from "./locale";
import { formatMessage } from "./format-message";
import type { MessageParams } from "./format-message";

/**
 * Typed message catalogs for the production UI.
 *
 * zh-CN is the key source of truth (`TranslationKey` is derived from it);
 * the en-US catalog is typed as `Record<TranslationKey, string>`, so a
 * missing or extra English key is a compile-time error — the Chinese UI
 * can never degrade into mixed-language fallback. Dynamic data (workspace
 * names, app names, folder names, page names, URLs, tags) is never in
 * these catalogs and never translated.
 */

const zhCNCatalog = {
  // --- Shared -------------------------------------------------------------
  "common.cancel": "取消",
  "common.save": "保存",
  "common.working": "处理中…",
  "common.retry": "重新加载",

  // --- Boot / startup -----------------------------------------------------
  "startup.status": "正在打开工作区…",

  // --- Onboarding ---------------------------------------------------------
  "onboarding.lead": "设置你的桌面——只需一个名称。",
  "onboarding.workspaceNameLabel": "工作区名称",
  "onboarding.createButton": "创建工作区",
  "onboarding.creatingButton": "创建中…",
  "onboarding.remoteUnavailable": "服务器不可用。可以先在本地开始,稍后同步。",
  "onboarding.error.enterName": "请输入工作区名称。",
  "onboarding.error.createFailed": "无法在此设备上创建工作区。",
  "onboarding.error.createException": "创建工作区失败。",
  "onboarding.defaultWorkspaceName": "我的 VelaDesk",
  "onboarding.defaultPageName": "主页",

  // --- Workspace picker ---------------------------------------------------
  "picker.lead": "选择要打开的工作区。",
  "picker.sourceLocal": "本地",
  "picker.sourceServer": "服务器",
  "picker.synced": "已同步",
  "picker.pending": "待同步",
  "picker.conflict": "冲突",
  "picker.revision": "版本 {revision}",
  "picker.error.notFound": "该工作区已不存在。",
  "picker.error.network": "无法连接服务器。",
  "picker.error.serverError": "服务器返回错误。",
  "picker.error.serverErrorStatus": "服务器返回错误(HTTP {status})。",
  "picker.error.protocol": "服务器响应异常。",
  "picker.error.openFailed": "打开工作区失败。",

  // --- Recovery -----------------------------------------------------------
  "recovery.lead": "无法打开本地工作区存储。",
  "recovery.technicalDetails": "技术细节",
  "recovery.noPages": "此工作区不包含任何页面,没有可显示的内容。",

  // --- Modes & top bar ----------------------------------------------------
  "mode.view": "查看",
  "mode.arrange": "整理",
  "mode.desktopModeLabel": "桌面模式",
  "topbar.search": "搜索",
  "topbar.searchTitle": "搜索(Ctrl/Cmd+K)",
  "topbar.settings": "设置",
  "topbar.add": "添加",
  "topbar.undoArrange": "撤销整理",
  "topbar.redoArrange": "重做整理",
  "topbar.undoTitle": "撤销整理(Ctrl/Cmd+Z)",
  "topbar.redoTitle": "重做整理(Ctrl/Cmd+Shift+Z)",
  "topbar.selectionCount": "已选择 {count} 项",
  "topbar.clearSelection": "清除",

  // --- Sync indicator -----------------------------------------------------
  "sync.synced": "已同步",
  "sync.pending": "待同步",
  "sync.offline": "离线",
  "sync.conflict": "冲突",
  "sync.syncing": "同步中…",
  "sync.conflictTitle": "冲突——解决功能将在后续版本提供",
  "sync.syncNowTitle": "立即同步",
  "sync.refreshTitle": "从服务器刷新",

  // --- Dock ---------------------------------------------------------------
  "dock.label": "程序坞",
  "dock.create": "新建",
  "dock.switchToViewTitle": "切换到查看模式",
  "dock.switchToArrangeTitle": "切换到整理模式",
  "dock.openApp": "打开 {name}",
  "dock.openFolder": "打开文件夹 {name}",

  // --- Context menus ------------------------------------------------------
  "menu.addApp": "添加应用",
  "menu.newFolder": "新建文件夹",
  "menu.switchToView": "切换到查看模式",
  "menu.switchToArrange": "切换到整理模式",
  "menu.open": "打开",
  "menu.edit": "编辑",
  "menu.moveToDesktop": "移到桌面",
  "menu.moveToFolder": "移到文件夹…",
  "menu.pinToDock": "固定到程序坞",
  "menu.removeFromDock": "从程序坞移除",
  "menu.delete": "删除",
  "menu.rename": "重命名",
  "menu.deleteFolder": "删除文件夹",
  "menu.widgetLater": "小组件编辑将在后续版本提供",

  // --- Dialog shared ------------------------------------------------------
  "dialog.nameLabel": "名称",
  "dialog.urlLabel": "网址",

  // --- Add App ------------------------------------------------------------
  "dialog.addApp.title": "添加应用",
  "dialog.addApp.add": "添加应用",
  "dialog.addApp.adding": "添加中…",
  "dialog.addApp.error.enterName": "请输入名称。",
  "dialog.addApp.error.enterUrl": "请输入网址。",
  "dialog.addApp.error.pageGone": "目标页面已不存在。",
  "dialog.addApp.error.folderGone": "该文件夹已不存在。",
  "dialog.addApp.error.duplicate": "此应用已存在于工作区。",
  "dialog.addApp.error.noSpace": "此页面已满——请先移除部分内容或切换页面。",
  "dialog.addApp.error.addFailed": "无法将应用添加到此工作区。",
  "dialog.addApp.error.exception": "添加应用失败。",

  // --- Edit App -----------------------------------------------------------
  "dialog.editApp.title": "编辑应用",
  "dialog.editApp.openMode": "打开方式",
  "dialog.editApp.mode.newTab": "新标签页",
  "dialog.editApp.mode.sameTab": "当前标签页",
  "dialog.editApp.mode.newWindow": "新窗口",
  "dialog.editApp.mode.popup": "弹出窗口",
  "dialog.editApp.saveChanges": "保存更改",
  "dialog.editApp.saving": "保存中…",
  "dialog.editApp.error.appGone": "该应用已不存在。",
  "dialog.editApp.error.saveFailed": "无法保存这些更改。",
  "dialog.editApp.error.exception": "保存应用失败。",

  // --- Delete App ---------------------------------------------------------
  "dialog.deleteApp.title": "删除 {name}?",
  "dialog.deleteApp.message": "该应用及其所有引用(页面、文件夹、程序坞)将被移除。",
  "dialog.deleteApp.confirm": "删除应用",
  "dialog.deleteApp.error.appGone": "该应用已不存在。",
  "dialog.deleteApp.error.failed": "无法删除该应用。",

  // --- Folder create / rename ---------------------------------------------
  "dialog.folder.newTitle": "新建文件夹",
  "dialog.folder.renameTitle": "重命名文件夹",
  "dialog.folder.nameLabel": "文件夹名称",
  "dialog.folder.create": "创建文件夹",
  "dialog.folder.rename": "重命名",
  "dialog.folder.saving": "保存中…",
  "dialog.folder.defaultName": "新建文件夹",
  "dialog.folder.error.enterName": "请输入文件夹名称。",
  "dialog.folder.error.pageGone": "当前页面已不存在。",
  "dialog.folder.error.folderGone": "该文件夹已不存在。",
  "dialog.folder.error.duplicate": "此文件夹已存在于工作区。",
  "dialog.folder.error.mustBeEmpty": "新文件夹必须为空。",
  "dialog.folder.error.noSpace": "此页面已满——请先移除部分内容。",
  "dialog.folder.error.saveFailed": "无法保存该文件夹。",
  "dialog.folder.error.exception": "保存文件夹失败。",

  // --- Delete folder ------------------------------------------------------
  "dialog.deleteFolder.title": "删除文件夹?",
  "dialog.deleteFolder.message": "文件夹内的应用将放回当前桌面。",
  "dialog.deleteFolder.confirm": "删除文件夹",
  "dialog.deleteFolder.error.noActivePage": "没有可放置应用的活跃页面。",
  "dialog.deleteFolder.error.noSpace": "此页面空间不足,无法移除文件夹。",
  "dialog.deleteFolder.error.folderGone": "该文件夹已不存在。",
  "dialog.deleteFolder.error.failed": "无法移除该文件夹。",

  // --- Folder overlay -----------------------------------------------------
  "overlay.addApp": "添加应用",
  "overlay.close": "关闭文件夹",
  "overlay.missingApp": "缺失的应用",
  "overlay.unsupported": "不支持的项目",
  "overlay.empty": "此文件夹为空。",

  // --- Move to folder -----------------------------------------------------
  "dialog.moveToFolder.title": "移到文件夹",
  "dialog.moveToFolder.empty": "暂无可移入的文件夹。",
  "dialog.moveToFolder.appCount": "{count} 个应用",
  "dialog.moveToFolder.error.appGone": "该应用已不存在。",
  "dialog.moveToFolder.error.folderGone": "该文件夹已不存在。",
  "dialog.moveToFolder.error.alreadyInside": "该应用已在此文件夹中。",
  "dialog.moveToFolder.error.failed": "无法移动该应用。",
  "dialog.moveToFolder.error.exception": "移动应用失败。",

  // --- Desktop items ------------------------------------------------------
  "item.missing": "缺失项目",
  "item.missingTitle": "此项目引用了缺失的实体",

  // --- Shell action errors ------------------------------------------------
  "shell.error.moveOutOfFolderNoSpace": "此页面空间不足,无法将应用移出文件夹。",
  "shell.error.moveToDesktopFailed": "无法将应用移到桌面。",

  // --- Launcher -----------------------------------------------------------
  "launcher.dialogLabel": "搜索工作区",
  "launcher.placeholder": "搜索应用、文件夹、页面和命令…",
  "launcher.kind.app": "应用",
  "launcher.kind.folder": "文件夹",
  "launcher.kind.page": "页面",
  "launcher.kind.command": "命令",
  "launcher.noMatches": "没有匹配结果",
  "launcher.hintNavigate": "↑↓ 导航",
  "launcher.hintOpen": "↵ 打开",
  "launcher.hintClose": "esc 关闭",
  "launcher.command.addApp": "添加应用",
  "launcher.command.newFolder": "新建文件夹",
  "launcher.command.openSettings": "设置",
  "launcher.command.switchToView": "切换到查看模式",
  "launcher.command.switchToArrange": "切换到整理模式",
  "launcher.command.syncNow": "立即同步",
  "launcher.command.refreshFromServer": "从服务器刷新",

  // --- Settings Center ----------------------------------------------------
  "settings.title": "设置",
  "settings.close": "关闭设置",
  "settings.sections": "设置分区",
  "settings.section.appearance": "外观",
  "settings.section.desktop": "桌面",
  "settings.section.general": "通用",
  "settings.colorMode": "颜色模式",
  "settings.colorMode.system": "跟随系统",
  "settings.colorMode.dark": "深色",
  "settings.colorMode.light": "浅色",
  "settings.colorMode.hint": "跟随系统会沿用操作系统的外观偏好。",
  "settings.accentHue": "强调色色调",
  "settings.wallpaper": "壁纸",
  "settings.wallpaper.aurora": "极光",
  "settings.wallpaper.midnight": "午夜",
  "settings.wallpaper.dawn": "晨曦",
  "settings.wallpaper.mist": "薄雾",
  "settings.surfaceOpacity": "表面不透明度",
  "settings.blur": "模糊",
  "settings.cornerRadius": "圆角",
  "settings.iconSize": "图标大小",
  "settings.iconSize.small": "小",
  "settings.iconSize.medium": "中",
  "settings.iconSize.large": "大",
  "settings.resetAppearance": "恢复默认外观",
  "settings.resetHint": "在此草稿中恢复默认外观——点击“保存”前不会写入任何更改。",
  "settings.defaultPage": "默认页面",
  "settings.defaultPageHint": "下次加载工作区时生效——当前页面不会切换。",
  "settings.startInView": "以查看模式启动",
  "settings.startInViewHint":
    "仅作为启动默认值——不切换当前模式;勾选后以查看模式打开,未勾选则以整理模式打开。",
  "settings.language": "界面语言",
  "settings.language.chinese": "中文",
  "settings.language.english": "English",
  "settings.language.hint": "语言只保存在当前浏览器,不会修改工作区数据。",
  "settings.error.defaultPageGone": "默认页面已不存在。",
  "settings.error.invalidAppearance": "所选外观值无效。",
  "settings.error.saveFailed": "设置保存失败。",
  "settings.unsavedChanges": "有未保存的更改",
  "settings.upToDate": "已是最新",
  "settings.saving": "保存中…",
} as const;

export type TranslationKey = keyof typeof zhCNCatalog;

export type MessageCatalog = Readonly<Record<TranslationKey, string>>;

/** The zh-CN catalog — key source of truth of the translation type. */
export const zhCN: MessageCatalog = zhCNCatalog;

/** English mirrors the current production copy verbatim. */
export const enUS: MessageCatalog = {
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.working": "Working…",
  "common.retry": "Reload",

  "startup.status": "Opening your workspace…",

  "onboarding.lead": "Set up your desk — one name is enough.",
  "onboarding.workspaceNameLabel": "Workspace name",
  "onboarding.createButton": "Create workspace",
  "onboarding.creatingButton": "Creating…",
  "onboarding.remoteUnavailable": "Server unavailable. You can start locally and sync later.",
  "onboarding.error.enterName": "Enter a workspace name.",
  "onboarding.error.createFailed": "The workspace could not be created on this device.",
  "onboarding.error.createException": "Creating the workspace failed.",
  "onboarding.defaultWorkspaceName": "My VelaDesk",
  "onboarding.defaultPageName": "Home",

  "picker.lead": "Choose a workspace to open.",
  "picker.sourceLocal": "Local",
  "picker.sourceServer": "Server",
  "picker.synced": "Synced",
  "picker.pending": "Pending",
  "picker.conflict": "Conflict",
  "picker.revision": "rev {revision}",
  "picker.error.notFound": "That workspace no longer exists.",
  "picker.error.network": "The server could not be reached.",
  "picker.error.serverError": "The server reported an error.",
  "picker.error.serverErrorStatus": "The server reported an error (HTTP {status}).",
  "picker.error.protocol": "The server responded unexpectedly.",
  "picker.error.openFailed": "Opening the workspace failed.",

  "recovery.lead": "Local workspace storage could not be opened.",
  "recovery.technicalDetails": "Technical details",
  "recovery.noPages": "This workspace contains no pages, so there is nothing to display.",

  "mode.view": "View",
  "mode.arrange": "Arrange",
  "mode.desktopModeLabel": "Desktop mode",
  "topbar.search": "Search",
  "topbar.searchTitle": "Search (Ctrl/Cmd+K)",
  "topbar.settings": "Settings",
  "topbar.add": "Add",
  "topbar.undoArrange": "Undo arrange",
  "topbar.redoArrange": "Redo arrange",
  "topbar.undoTitle": "Undo arrange (Ctrl/Cmd+Z)",
  "topbar.redoTitle": "Redo arrange (Ctrl/Cmd+Shift+Z)",
  "topbar.selectionCount": "{count} selected",
  "topbar.clearSelection": "Clear",

  "sync.synced": "Synced",
  "sync.pending": "Pending",
  "sync.offline": "Offline",
  "sync.conflict": "Conflict",
  "sync.syncing": "Syncing…",
  "sync.conflictTitle": "Conflict — resolution comes in a later update",
  "sync.syncNowTitle": "Sync now",
  "sync.refreshTitle": "Refresh from server",

  "dock.label": "Dock",
  "dock.create": "Create",
  "dock.switchToViewTitle": "Switch to view mode",
  "dock.switchToArrangeTitle": "Switch to arrange mode",
  "dock.openApp": "Open {name}",
  "dock.openFolder": "Open folder {name}",

  "menu.addApp": "Add App",
  "menu.newFolder": "New Folder",
  "menu.switchToView": "Switch to View mode",
  "menu.switchToArrange": "Switch to Arrange mode",
  "menu.open": "Open",
  "menu.edit": "Edit",
  "menu.moveToDesktop": "Move to Desktop",
  "menu.moveToFolder": "Move to Folder…",
  "menu.pinToDock": "Pin to Dock",
  "menu.removeFromDock": "Remove from Dock",
  "menu.delete": "Delete",
  "menu.rename": "Rename",
  "menu.deleteFolder": "Delete Folder",
  "menu.widgetLater": "Widget editing later",

  "dialog.nameLabel": "Name",
  "dialog.urlLabel": "URL",

  "dialog.addApp.title": "Add app",
  "dialog.addApp.add": "Add app",
  "dialog.addApp.adding": "Adding…",
  "dialog.addApp.error.enterName": "Enter a name.",
  "dialog.addApp.error.enterUrl": "Enter a URL.",
  "dialog.addApp.error.pageGone": "The target page no longer exists.",
  "dialog.addApp.error.folderGone": "This folder no longer exists.",
  "dialog.addApp.error.duplicate": "This app already exists in the workspace.",
  "dialog.addApp.error.noSpace": "This page is full — remove something or switch pages first.",
  "dialog.addApp.error.addFailed": "The app could not be added to this workspace.",
  "dialog.addApp.error.exception": "Adding the app failed.",

  "dialog.editApp.title": "Edit app",
  "dialog.editApp.openMode": "Open mode",
  "dialog.editApp.mode.newTab": "New tab",
  "dialog.editApp.mode.sameTab": "Same tab",
  "dialog.editApp.mode.newWindow": "New window",
  "dialog.editApp.mode.popup": "Popup window",
  "dialog.editApp.saveChanges": "Save changes",
  "dialog.editApp.saving": "Saving…",
  "dialog.editApp.error.appGone": "This app no longer exists.",
  "dialog.editApp.error.saveFailed": "The changes could not be saved.",
  "dialog.editApp.error.exception": "Saving the app failed.",

  "dialog.deleteApp.title": "Delete {name}?",
  "dialog.deleteApp.message":
    "The app and every reference to it (pages, folders, dock) will be removed.",
  "dialog.deleteApp.confirm": "Delete app",
  "dialog.deleteApp.error.appGone": "This app no longer exists.",
  "dialog.deleteApp.error.failed": "The app could not be deleted.",

  "dialog.folder.newTitle": "New folder",
  "dialog.folder.renameTitle": "Rename folder",
  "dialog.folder.nameLabel": "Folder name",
  "dialog.folder.create": "Create folder",
  "dialog.folder.rename": "Rename",
  "dialog.folder.saving": "Saving…",
  "dialog.folder.defaultName": "New Folder",
  "dialog.folder.error.enterName": "Enter a folder name.",
  "dialog.folder.error.pageGone": "The active page no longer exists.",
  "dialog.folder.error.folderGone": "This folder no longer exists.",
  "dialog.folder.error.duplicate": "This folder already exists in the workspace.",
  "dialog.folder.error.mustBeEmpty": "New folders must start empty.",
  "dialog.folder.error.noSpace": "This page is full — remove something first.",
  "dialog.folder.error.saveFailed": "The folder could not be saved.",
  "dialog.folder.error.exception": "Saving the folder failed.",

  "dialog.deleteFolder.title": "Delete folder?",
  "dialog.deleteFolder.message": "Apps inside will be returned to the current desktop.",
  "dialog.deleteFolder.confirm": "Delete folder",
  "dialog.deleteFolder.error.noActivePage": "There is no active page to move the apps to.",
  "dialog.deleteFolder.error.noSpace": "Not enough room on this page to remove the folder.",
  "dialog.deleteFolder.error.folderGone": "This folder no longer exists.",
  "dialog.deleteFolder.error.failed": "The folder could not be removed.",

  "overlay.addApp": "Add App",
  "overlay.close": "Close folder",
  "overlay.missingApp": "Missing app",
  "overlay.unsupported": "Unsupported item",
  "overlay.empty": "This folder is empty.",

  "dialog.moveToFolder.title": "Move to folder",
  "dialog.moveToFolder.empty": "No reachable folders yet.",
  "dialog.moveToFolder.appCount": "{count} apps",
  "dialog.moveToFolder.error.appGone": "This app no longer exists.",
  "dialog.moveToFolder.error.folderGone": "This folder no longer exists.",
  "dialog.moveToFolder.error.alreadyInside": "The app is already in that folder.",
  "dialog.moveToFolder.error.failed": "The app could not be moved.",
  "dialog.moveToFolder.error.exception": "Moving the app failed.",

  "item.missing": "Missing item",
  "item.missingTitle": "This item references a missing entity",

  "shell.error.moveOutOfFolderNoSpace":
    "Not enough room on this page to move the app out of the folder.",
  "shell.error.moveToDesktopFailed": "The app could not be moved to the desktop.",

  "launcher.dialogLabel": "Search workspace",
  "launcher.placeholder": "Search apps, folders, pages and commands…",
  "launcher.kind.app": "App",
  "launcher.kind.folder": "Folder",
  "launcher.kind.page": "Page",
  "launcher.kind.command": "Command",
  "launcher.noMatches": "No matches",
  "launcher.hintNavigate": "↑↓ navigate",
  "launcher.hintOpen": "↵ open",
  "launcher.hintClose": "esc close",
  "launcher.command.addApp": "Add App",
  "launcher.command.newFolder": "New Folder",
  "launcher.command.openSettings": "Settings",
  "launcher.command.switchToView": "Switch to View",
  "launcher.command.switchToArrange": "Switch to Arrange",
  "launcher.command.syncNow": "Sync Now",
  "launcher.command.refreshFromServer": "Refresh from Server",

  "settings.title": "Settings",
  "settings.close": "Close settings",
  "settings.sections": "Settings sections",
  "settings.section.appearance": "Appearance",
  "settings.section.desktop": "Desktop",
  "settings.section.general": "General",
  "settings.colorMode": "Color mode",
  "settings.colorMode.system": "System",
  "settings.colorMode.dark": "Dark",
  "settings.colorMode.light": "Light",
  "settings.colorMode.hint": "System follows your operating system preference.",
  "settings.accentHue": "Accent hue",
  "settings.wallpaper": "Wallpaper",
  "settings.wallpaper.aurora": "Aurora",
  "settings.wallpaper.midnight": "Midnight",
  "settings.wallpaper.dawn": "Dawn",
  "settings.wallpaper.mist": "Mist",
  "settings.surfaceOpacity": "Surface opacity",
  "settings.blur": "Blur",
  "settings.cornerRadius": "Corner radius",
  "settings.iconSize": "Icon size",
  "settings.iconSize.small": "Small",
  "settings.iconSize.medium": "Medium",
  "settings.iconSize.large": "Large",
  "settings.resetAppearance": "Reset appearance",
  "settings.resetHint":
    "Restores the default look in this draft — nothing is saved until you press Save.",
  "settings.defaultPage": "Default page",
  "settings.defaultPageHint":
    "Applied the next time the workspace loads — the current page does not switch.",
  "settings.startInView": "Start in View mode",
  "settings.startInViewHint":
    "Startup default only — the current mode is not switched, and the workspace opens in View mode when checked or Arrange mode when unchecked.",
  "settings.language": "Interface language",
  "settings.language.chinese": "中文",
  "settings.language.english": "English",
  "settings.language.hint": "The language is saved in this browser only and never changes workspace data.",
  "settings.error.defaultPageGone": "The default page no longer exists.",
  "settings.error.invalidAppearance": "The selected appearance values are invalid.",
  "settings.error.saveFailed": "Settings could not be saved.",
  "settings.unsavedChanges": "Unsaved changes",
  "settings.upToDate": "Up to date",
  "settings.saving": "Saving…",
};

export type { MessageParams };

/** Resolves the catalog of a locale. */
export function getMessages(locale: UiLocale): MessageCatalog {
  return locale === "en-US" ? enUS : zhCN;
}

/** Translates one key in a locale, with optional interpolation params. */
export function translate(locale: UiLocale, key: TranslationKey, params?: MessageParams): string {
  return formatMessage(getMessages(locale)[key], params);
}
