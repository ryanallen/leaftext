(() => {
  const STORAGE_KEY = 'leaf.localeMode';
  const MODE_FALLBACK = 'system';
  const VALID_MODES = new Set(['system', 'en', 'zh-CN']);
  const TRANSLATIONS = {
    en: {
      'actions.back': 'Back',
      'actions.back.title': 'Go back',
      'actions.chooseFile': 'Choose file',
      'actions.close': 'Close file',
      'actions.close.title': 'Close current file',
      'actions.closeTab': 'Close tab',
      'actions.copyCode': 'Copy code',
      'actions.copiedCode': 'Copied',
      'actions.home': 'Home',
      'actions.home.title': 'Show recent files',
      'actions.forward': 'Forward',
      'actions.forward.title': 'Go forward',
      'actions.open': 'Open',
      'actions.open.title': 'Open Markdown file',
      'actions.codeView': 'View source',
      'actions.codeView.title': 'Toggle raw source view',
      'actions.save': 'Save',
      'actions.save.title': 'Save changes',
      'actions.undo': 'Undo',
      'actions.undo.title': 'Undo last edit',
      'actions.more': 'More options',
      'toolbar.label': 'Views and edits',
      'toolbar.views': 'Views',
      'toolbar.reading': 'Reading',
      'toolbar.readingTools': 'Reading tools',
      'toolbar.speedReader': 'Speed reader',
      'toolbar.unlock': 'Unlock to edit this page',
      'toolbar.lock': 'Lock this page (read-only)',
      'reader.loading': 'Loading document…',
      'glossary.loading': 'Loading glossary…',
      'glossary.noEntry': 'No glossary entry for “{term}”.',
      'glossary.missing': 'No glossary file near this document.',
      'glossary.failed': 'Couldn’t open the glossary.',
      'actions.revealFile': 'Reveal file',
      'actions.cut': 'Cut',
      'actions.copy': 'Copy',
      'actions.copyPath': 'Copy path',
      'actions.rename': 'Rename',
      'actions.properties': 'Properties',
      'actions.getInfo': 'Get Info',
      'actions.delete': 'Delete',
      'empty.description': 'Open a file and read it in peace. It stays on your device, in plain text you own.',
      'empty.description.incised': 'For two thousand years knowledge was incised on palm leaves — talipot and palmyra, dried and smoke-cured. Turn over a new one.',
      'empty.description.stylus': 'Scribes cut letters into palm leaves with a stylus, then rubbed in soot so the words rose to the surface. Read on.',
      'empty.description.bound': 'A palm-leaf book was threaded through a single hole and bound between wooden covers. Open yours.',
      'empty.description.lifespan': 'A palm leaf holds its text for a few decades — six hundred years at most — so temples recopied the old ones before they wore away.',
      'empty.description.roundLetters': 'The round letters of Devanagari, Kannada, and Telugu curved that way so sharp strokes would not tear the leaf.',
      'empty.description.lontar': 'In Indonesia these leaf-books were called lontar, from the old words for “leaf” and “palmyra palm.”',
      'empty.description.coldDry': 'The oldest palm-leaf manuscripts survived in cold, dry places — Nepal, Tibet, the high passes of central Asia.',
      'empty.description.bali': 'In Bali, Brahmin scribes still rewrite the sacred texts onto palm leaves by hand.',
      'empty.description.printing': 'The printing press ended the long cycle of copying palm leaf to palm leaf in the early 1800s.',
      'empty.kicker': 'Leaf Text',
      'empty.noRecent': 'Files you open show up here, so you can pick up where you left off.',
      'empty.title': 'Refine your mind.',
      'empty.subtitle': 'Your thoughts, secure and free.',
      'errors.openFailed': 'Failed to open {path}: {reason}',
      'format.fileSizeUnknown': 'Unknown size',
      'library.title': 'Library',
      'library.view.graph': 'Graph',
      'library.view.graph.on': 'Show how these documents link',
      'library.view.graph.off': 'Back to the document',
      'library.vaults.label': 'Vaults',
      'library.vaults.switch': 'Switch vault (in {name})',
      'library.vaults.all': 'Everything the library has indexed',
      'library.vaults.new': 'New vault…',
      'library.vaults.new.help': 'Choose a folder to use as a library root',
      'library.vaults.edit': 'Edit {name}',
      'library.vaults.editing': 'Editing {name}',
      'library.vaults.name': 'Vault name',
      'library.vaults.changeFolder': 'Change folder…',
      'library.vaults.remove': 'Remove vault',
      'library.vaults.remove.help': 'Forgets the vault. The folder and its files are left alone.',
      'library.vaults.back': 'Back',
      'library.vaults.sync': 'GitHub',
      'library.vaults.sync.reading': 'Checking this folder…',
      'library.vaults.sync.noGit': 'Syncing needs git, which is not installed.',
      'library.vaults.sync.getGit': 'Install git ↗',
      'library.vaults.sync.noRemote': 'A repository here, with nowhere to push',
      'library.vaults.sync.clean': 'up to date',
      'library.vaults.sync.changed': '{count} changed',
      'library.vaults.sync.ahead': '{count} to push',
      'library.vaults.sync.behind': '{count} to pull',
      'library.vaults.sync.now': 'Sync',
      'library.vaults.sync.pending': 'Sync {count} to GitHub',
      'library.vaults.sync.working': 'Working…',
      'library.vaults.sync.create': 'Create a private repo',
      'library.vaults.sync.createOnGitHub': 'Create it on GitHub ↗',
      'library.vaults.sync.createOnGitHub.help': 'Opens GitHub with the name filled in. Copy the address it gives you and paste it below.',
      'library.vaults.sync.pasteUrl': 'Paste the repository address',
      'library.vaults.sync.inside': 'This folder sits inside {repo}. A repository here is separate from it.',
      'library.vaults.sync.nested': 'Already repositories, and left alone: {list}',
      'library.vaults.sync.noIdentity': 'git does not know who you are yet. Set user.name and user.email.',
      'library.vaults.sync.noHelper': 'git has no way to sign in to GitHub, so a push will fail.',
      'library.vaults.sync.done.created': 'Created on GitHub and pushed.',
      'library.vaults.sync.done.linked': 'Linked and pushed.',
      'library.vaults.sync.done.localOnly': 'This folder is a repository now. Make one on GitHub and paste its address.',
      'library.vaults.sync.done.pushed': 'Pushed {count} changed.',
      'library.vaults.sync.done.pushedTo': 'Pushed {count} to {repo}.',
      'library.vaults.sync.done.upToDate': 'Nothing to send.',
      'library.up': 'Back to {name}',
      'library.crumbs.label': 'Folder path',
      'library.crumbs.enter': 'Open {name}',
      'library.crumbs.more': 'Skipped folders: {names}',
      'library.graph.empty': 'No links to graph yet.',
      'library.graph.needsVault': 'Pick a vault to see how its documents link.',
      'library.graph.error': 'Graph failed to load.',
      'library.graph.truncated': 'Showing the {count} most-linked documents.',
      'library.folderEmpty': 'Nothing to read in this folder.',
      'library.open': 'Library',
      'library.divider.resize': 'Resize library',
      'library.search.placeholder': 'Search files…',
      'library.search.noResults': 'No matches.',
      'library.search.count': '{count} results',
      'library.search.loading': 'Searching…',
      'library.search.error': 'Search failed.',
      'recent.headingWithCount': 'Recent ({count})',
      'recent.openTitle': 'Open {path}',
      'minimap.aria': 'Document minimap',
      'outline.title': 'Outline',
      'outline.lineCount': '({count} lines)',
      'settings.heading': 'Settings',
      'update.available': 'Update to v{version}',
      'update.downloading': 'Downloading v{version}… {percent}%',
      'update.restart': 'Restart to update',
      'update.failed': 'Update failed — open release page',
      'update.failedReason': 'Update failed: {message}',
      'update.title': 'A new version is available',
      'update.check': 'Check for updates',
      'update.checkTitle': 'Ask GitHub for the latest release now',
      'update.checking': 'Checking…',
      'update.upToDate': 'Up to date.',
      'update.lastChecked': 'Last checked {when}.',
      'update.checkedNow': 'Checked just now.',
      'update.checkFailed': 'Could not reach GitHub: {message}',
      'update.applyFailed': 'Installing v{version} failed: {message}',
      'update.httpError': 'GitHub answered {status}',
      'update.noInstaller': 'This release publishes no installer for this platform — the button opens the release page.',
      'settings.version': 'Version',
      'settings.theme.appearance': 'Appearance',
      'settings.theme.aria': 'Theme',
      'settings.theme.dark': 'Dark',
      'settings.theme.daylight': 'Daylight',
      'settings.theme.family.amaranth': 'Amaranth',
      'settings.theme.family.fern': 'Fern',
      'settings.theme.family.github': 'GitHub',
      'settings.theme.family.halcyon': 'Halcyon',
      'settings.theme.family.nightshade': 'Nightshade',
      'settings.theme.family.sage': 'Sage',
      'settings.theme.family.random': 'Random',
      'settings.theme.help': 'System follows device preference; Daylight is light by day, dark at night.',
      'settings.theme.label': 'Theme',
      'settings.theme.light': 'Light',
      'settings.theme.sheet.browse': 'Add your own theme on GitHub →',
      'settings.theme.sheet.close': 'Close',
      'settings.theme.sheet.title': 'Themes',
      'settings.theme.system': 'System',
      'settings.minimap.aria': 'Show document minimap',
      'settings.minimap.help': 'Show a scrollable document overview on wider windows.',
      'settings.minimap.label': 'Show minimap',
      'settings.graphScope.aria': 'Graph size',
      'settings.graphScope.label': 'Graph size',
      'settings.graphScope.help': 'How many documents the graph view draws. Smaller is faster.',
      'settings.graphScope.small': 'Focus (open document + links)',
      'settings.graphScope.medium': 'Medium (up to 2,000)',
      'settings.graphScope.large': 'Large (up to 5,000)',
      'settings.graphScope.xl': 'Everything',
      'settings.speedReader.aria': 'Speed Reader',
      'settings.speedReader.help': 'Make prose quieter and add bold lead anchors for faster scanning.',
      'settings.speedReader.label': 'Speed Reader',
      'titles.app': 'Leaf Text',
      'titles.document': '{title} - Leaf Text',
    },
    'zh-CN': {
      'actions.chooseFile': '选择文件',
      'actions.close': '关闭文件',
      'actions.close.title': '关闭当前文件',
      'actions.closeTab': '关闭标签页',
      'actions.copyCode': '复制代码',
      'actions.copiedCode': '已复制',
      'actions.home': '主页',
      'actions.home.title': '显示最近文件',
      'actions.open': '打开',
      'actions.open.title': '打开 Markdown 文件',
      'actions.codeView': '查看源码',
      'actions.codeView.title': '切换源码视图',
      'actions.save': '保存',
      'actions.save.title': '保存更改',
      'actions.undo': '撤销',
      'actions.undo.title': '撤销上次编辑',
      'actions.more': '更多选项',
      'toolbar.label': '视图与编辑',
      'toolbar.views': '视图',
      'toolbar.reading': '阅读',
      'toolbar.readingTools': '阅读工具',
      'toolbar.speedReader': '快速阅读',
      'toolbar.unlock': '解锁以编辑此页',
      'toolbar.lock': '锁定此页（只读）',
      'reader.loading': '正在加载文档…',
      'glossary.loading': '正在加载词汇表…',
      'glossary.noEntry': '没有“{term}”的词汇表条目。',
      'glossary.missing': '此文档附近没有词汇表文件。',
      'glossary.failed': '无法打开词汇表。',
      'actions.revealFile': '在文件管理器中显示',
      'actions.cut': '剪切',
      'actions.copy': '复制',
      'actions.copyPath': '复制路径',
      'actions.rename': '重命名',
      'actions.properties': '属性',
      'actions.getInfo': '显示简介',
      'actions.delete': '删除',
      'empty.description': '打开一个文件，静心阅读。它只留在你的设备上，是你自己拥有的纯文本。',
      'empty.description.incised': '两千年来，知识被刻写在棕榈叶上——经晾干烟熏的贝叶棕与糖棕。翻开新的一叶。',
      'empty.description.stylus': '抄写者以铁笔将文字刻入棕榈叶，再揉入烟灰，让字迹浮现。继续读下去。',
      'empty.description.bound': '贝叶经以一线穿孔串连，夹在木质封板之间。翻开你的那一卷。',
      'empty.description.lifespan': '一片棕榈叶能存字数十年，至多约六百年——于是寺院在旧叶朽坏前将其重抄。',
      'empty.description.roundLetters': '天城文、卡纳达文与泰卢固文的圆润字形，正是为了不让锋利的笔画划破叶面。',
      'empty.description.lontar': '在印度尼西亚，这些叶书被称为 lontar，源自古爪哇语中“叶”与“糖棕”二字。',
      'empty.description.coldDry': '最古老的贝叶写本留存于寒冷干燥之地——尼泊尔、西藏，以及中亚的高山隘口。',
      'empty.description.bali': '在巴厘岛，婆罗门抄经者至今仍以手将圣典重写于棕榈叶上。',
      'empty.description.printing': '十九世纪初，印刷术终结了贝叶之间世代相传的抄写。',
      'empty.kicker': 'Leaf Text',
      'empty.noRecent': '你打开过的文件会显示在这里，方便随时接着读。',
      'empty.title': '打磨你的思想。',
      'empty.subtitle': '你的思绪，安全而自由。',
      'errors.openFailed': '无法打开 {path}：{reason}',
      'format.fileSizeUnknown': '大小未知',
      'library.title': '文库',
      'library.view.graph': '关系图',
      'library.view.graph.on': '查看这些文档的链接关系',
      'library.view.graph.off': '返回文档',
      'library.vaults.label': '保管库',
      'library.vaults.switch': '切换保管库（当前：{name}）',
      'library.vaults.all': '文库已索引的全部内容',
      'library.vaults.new': '新建保管库…',
      'library.vaults.new.help': '选择一个文件夹作为文库根目录',
      'library.vaults.edit': '编辑 {name}',
      'library.vaults.editing': '正在编辑 {name}',
      'library.vaults.name': '保管库名称',
      'library.vaults.changeFolder': '更换文件夹…',
      'library.vaults.remove': '移除保管库',
      'library.vaults.remove.help': '仅移除保管库记录，文件夹及其文件不受影响。',
      'library.vaults.back': '返回',
      'library.vaults.sync': 'GitHub',
      'library.vaults.sync.reading': '正在检查此文件夹…',
      'library.vaults.sync.noGit': '同步需要 git，但尚未安装。',
      'library.vaults.sync.getGit': '安装 git ↗',
      'library.vaults.sync.noRemote': '此处有仓库，但没有推送目标',
      'library.vaults.sync.clean': '已是最新',
      'library.vaults.sync.changed': '{count} 处改动',
      'library.vaults.sync.ahead': '{count} 个待推送',
      'library.vaults.sync.behind': '{count} 个待拉取',
      'library.vaults.sync.now': '同步',
      'library.vaults.sync.pending': '同步 {count} 项到 GitHub',
      'library.vaults.sync.working': '正在处理…',
      'library.vaults.sync.create': '创建私有仓库',
      'library.vaults.sync.createOnGitHub': '在 GitHub 上创建 ↗',
      'library.vaults.sync.createOnGitHub.help': '打开 GitHub 并填好名称。复制它给出的地址，粘贴到下方。',
      'library.vaults.sync.pasteUrl': '粘贴仓库地址',
      'library.vaults.sync.inside': '此文件夹位于 {repo} 之内。在这里建立的仓库与它相互独立。',
      'library.vaults.sync.nested': '已是仓库，不作改动：{list}',
      'library.vaults.sync.noIdentity': 'git 还不知道你是谁。请设置 user.name 与 user.email。',
      'library.vaults.sync.noHelper': 'git 无法登录 GitHub，推送将会失败。',
      'library.vaults.sync.done.created': '已在 GitHub 创建并推送。',
      'library.vaults.sync.done.linked': '已关联并推送。',
      'library.vaults.sync.done.localOnly': '此文件夹现在是一个仓库。请在 GitHub 上创建并粘贴其地址。',
      'library.vaults.sync.done.pushed': '已推送 {count} 处改动。',
      'library.vaults.sync.done.pushedTo': '已推送 {count} 处改动到 {repo}。',
      'library.vaults.sync.done.upToDate': '没有需要发送的内容。',
      'library.up': '返回 {name}',
      'library.crumbs.label': '文件夹路径',
      'library.crumbs.enter': '打开 {name}',
      'library.crumbs.more': '省略的文件夹：{names}',
      'library.graph.empty': '暂无可用的链接关系。',
      'library.graph.needsVault': '请先选择保管库，以查看其文档的链接关系。',
      'library.graph.error': '关系图加载失败。',
      'library.graph.truncated': '仅显示链接最多的 {count} 个文档。',
      'library.folderEmpty': '此文件夹中没有可读的文档。',
      'library.open': '文库',
      'library.divider.resize': '调整文库宽度',
      'library.search.placeholder': '搜索文件…',
      'library.search.noResults': '无匹配结果。',
      'library.search.count': '{count} 条结果',
      'library.search.loading': '正在搜索…',
      'library.search.error': '搜索失败。',
      'recent.headingWithCount': '最近文件（{count}）',
      'recent.openTitle': '打开 {path}',
      'minimap.aria': '文档缩略图',
      'outline.title': '大纲',
      'outline.lineCount': '（{count} 行）',
      'settings.heading': '设置',
      'update.available': '更新到 v{version}',
      'update.downloading': '正在下载 v{version}… {percent}%',
      'update.restart': '重启以更新',
      'update.failed': '更新失败 — 打开发布页面',
      'update.failedReason': '更新失败：{message}',
      'update.title': '有新版本可用',
      'update.check': '检查更新',
      'update.checkTitle': '立即向 GitHub 查询最新版本',
      'update.checking': '正在检查…',
      'update.upToDate': '已是最新版本。',
      'update.lastChecked': '上次检查：{when}。',
      'update.checkedNow': '刚刚检查过。',
      'update.checkFailed': '无法连接 GitHub：{message}',
      'update.applyFailed': '安装 v{version} 失败：{message}',
      'update.httpError': 'GitHub 返回 {status}',
      'update.noInstaller': '此版本没有发布适用于该平台的安装包 — 此按钮会打开发布页面。',
      'settings.version': '版本',
      'settings.theme.appearance': '外观',
      'settings.theme.aria': '主题',
      'settings.theme.dark': '深色',
      'settings.theme.daylight': '日间自动',
      'settings.theme.family.amaranth': 'Amaranth',
      'settings.theme.family.fern': 'Fern',
      'settings.theme.family.github': 'GitHub',
      'settings.theme.family.halcyon': 'Halcyon',
      'settings.theme.family.nightshade': 'Nightshade',
      'settings.theme.family.sage': 'Sage',
      'settings.theme.family.random': '随机',
      'settings.theme.help': '跟随系统显示偏好；“日间自动”白天浅色、夜间深色。',
      'settings.theme.label': '主题',
      'settings.theme.light': '浅色',
      'settings.theme.sheet.browse': '在 GitHub 上添加你的主题 →',
      'settings.theme.sheet.close': '关闭',
      'settings.theme.sheet.title': '主题',
      'settings.theme.system': '跟随系统',
      'settings.minimap.aria': '显示文档缩略图',
      'settings.minimap.help': '在较宽窗口中显示可滚动的文档概览。',
      'settings.minimap.label': '显示缩略图',
      'settings.graphScope.aria': '关系图规模',
      'settings.graphScope.label': '关系图规模',
      'settings.graphScope.help': '关系图绘制的文档数量。规模越小越快。',
      'settings.graphScope.small': '聚焦（当前文档及其链接）',
      'settings.graphScope.medium': '中等（最多 2,000）',
      'settings.graphScope.large': '大（最多 5,000）',
      'settings.graphScope.xl': '全部',
      'settings.speedReader.aria': '快速阅读',
      'settings.speedReader.help': '弱化正文干扰，并为词首添加加粗引导，方便快速浏览。',
      'settings.speedReader.label': '快速阅读',
      'titles.app': 'Leaf Text',
      'titles.document': '{title} - Leaf Text',
    },  };
  const root = document.documentElement;
  const listeners = new Set();
  const createModeStorage = (storageKey) => ({
    read() {
      try {
        return window.localStorage ? window.localStorage.getItem(storageKey) : null;
      } catch (_) {
        return null;
      }
    },
    write(value) {
      try {
        if (window.localStorage) {
          window.localStorage.setItem(storageKey, value);
        }
      } catch (_) {}
    },
  });
  const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);
  const systemLanguage = () => {
    const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
    return languages[0] || navigator.language || '';
  };
  const resolveSystemLocale = () => {
    const language = String(systemLanguage()).trim().toLowerCase();
    return language.startsWith('zh') ? 'zh-CN' : 'en';
  };
  const resolveLocale = () => (mode === 'system' ? resolveSystemLocale() : mode);
  const interpolate = (message, values = {}) => message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
  const translate = (key, values = {}) => {
    const resolvedLocale = resolveLocale();
    const message = (TRANSLATIONS[resolvedLocale] && TRANSLATIONS[resolvedLocale][key]) || TRANSLATIONS.en[key] || key;
    return interpolate(message, values);
  };
  const snapshot = () => ({ mode, resolvedLocale: resolveLocale() });
  const apply = () => {
    const locale = snapshot();
    root.lang = locale.resolvedLocale;
    root.dataset.localeMode = locale.mode;
    root.dataset.locale = locale.resolvedLocale;
    listeners.forEach((listener) => listener(locale));
  };

  const storage = createModeStorage(STORAGE_KEY);
  let mode = normalizeMode(storage.read());

  window.leafLocale = {
    getMode: () => mode,
    getResolvedLocale: resolveLocale,
    setMode(nextMode) {
      mode = normalizeMode(nextMode);
      storage.write(mode);
      apply();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    t: translate,
    formatNumber(value, options) {
      return new Intl.NumberFormat(resolveLocale(), options).format(value);
    },
    formatDate(value, options) {
      return new Intl.DateTimeFormat(resolveLocale(), options).format(value);
    },
    formatRelativeTime(value, unit, options) {
      return new Intl.RelativeTimeFormat(resolveLocale(), options).format(value, unit);
    },
    formatFileSize(bytes) {
      const number = Number(bytes);
      if (!Number.isFinite(number)) {
        return translate('format.fileSizeUnknown');
      }
      const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
      let size = Math.abs(number);
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }
      const signedSize = number < 0 ? -size : size;
      return new Intl.NumberFormat(resolveLocale(), {
        maximumFractionDigits: unitIndex === 0 ? 0 : 1,
        style: 'unit',
        unit: units[unitIndex],
        unitDisplay: 'short',
      }).format(signedSize);
    },
  };

  window.addEventListener('languagechange', () => {
    if (mode === 'system') {
      apply();
    }
  });

  apply();
})();
