// Right-click menu for the library pane, the tab bar, and a link in the document,
// acting on whatever the pointer is over: a file, a folder, a link, or the folder
// you are browsing when it is over none of them. Groups: open, clipboard, rename,
// locate, and destructive delete last.
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.hidden = true;
contextMenu.setAttribute('role', 'menu');
document.body.appendChild(contextMenu);
let contextMenuPath = null;
// What was right-clicked: 'file', 'folder', 'here' (the pane's empty space,
// standing for the folder being browsed), or 'link' (a link in the document, whose
// href sits in contextMenuPath). It picks which list of items to show.
let contextMenuTargetKind = 'file';
// The link element itself when the menu is a link's, so Open runs the same path a
// plain click on it does rather than a second reading of the href.
let contextMenuLink = null;
const CONTEXT_MENU_ITEMS = [
  { action: 'open', label: 'Open' },
  { action: 'favorite', label: 'Favorite' },
  'separator',
  { action: 'cut', label: 'Cut' },
  { action: 'copy', label: 'Copy' },
  { action: 'copyPath', label: 'Copy path' },
  'separator',
  { action: 'rename', label: 'Rename' },
  'separator',
  { action: 'reveal', label: 'Reveal file' },
  { action: 'properties', label: isMacPlatform ? 'Get Info' : 'Properties' },
  'separator',
  { action: 'delete', label: 'Delete', danger: true },
];
// A folder, or the empty space in the pane, which stands for the folder you are
// browsing. No Copy path for a place you can't open as a document; Paste is the
// item this menu exists for.
const FOLDER_MENU_ITEMS = [
  { action: 'openFolder', label: 'Open folder', folderOnly: true },
  { action: 'favorite', label: 'Favorite', folderOnly: true },
  'separator',
  { action: 'paste', label: 'Paste' },
  'separator',
  // "Reveal folder" beside the file menu's "Reveal file" — one verb for the one
  // action, rather than naming the file manager on each platform.
  { action: 'reveal', label: 'Reveal folder' },
  { action: 'properties', label: isMacPlatform ? 'Get Info' : 'Properties' },
];
// A link in the document being read. The two Open items and the copies are all the
// page can do on its own; `pageOnly` items need somewhere in the app to go, so they
// drop off an external link and an in-page jump.
const LINK_MENU_ITEMS = [
  { action: 'openLink', label: 'Open' },
  { action: 'openLinkInNewPage', label: 'Open in new page', pageOnly: true },
  'separator',
  { action: 'copyLink', label: 'Copy link' },
  { action: 'copyLinkText', label: 'Copy link text' },
  'separator',
  // The host resolves the href into a real path for these two; the page cannot.
  { action: 'revealLink', label: 'Reveal file', pageOnly: true },
  { action: 'copyLinkPath', label: 'Copy path', pageOnly: true },
];
function hideContextMenu() {
  if (contextMenu.hidden) {
    return;
  }
  contextMenu.hidden = true;
  contextMenuPath = null;
  contextMenuLink = null;
}
// What Cut or Copy last put down, so Paste has something to act on. The page holds
// it because the page is where it was chosen; it is not the system clipboard, so
// pasting here moves what you cut *here*, and a file copied in Explorer is not it.
let libraryTransfer = null;
function runContextAction(action, path, link) {
  switch (action) {
    case 'open': send({ command: 'openRecent', path }); break;
    case 'openLink': if (link) sendDocumentLink(link, false); break;
    case 'openLinkInNewPage': if (link) sendDocumentLink(link, true); break;
    // The href as it is written, not the resolved one — Copy path is the item for
    // the file on disk.
    case 'copyLink': copyPlainText(path); break;
    case 'copyLinkText': if (link) copyPlainText((link.textContent || '').trim()); break;
    case 'revealLink': send({ command: 'revealLink', href: path }); break;
    case 'copyLinkPath': send({ command: 'copyLinkPath', href: path }); break;
    case 'openFolder': setLibraryFolder(path); break;
    case 'cut':
      libraryTransfer = { path, cut: true };
      send({ command: 'copyFile', path, cut: true });
      break;
    case 'copy':
      libraryTransfer = { path, cut: false };
      send({ command: 'copyFile', path, cut: false });
      break;
    case 'paste': {
      // The cut file is consumed; a copied one can be pasted again, the way every
      // other file manager behaves.
      const transfer = libraryTransfer;
      if (!transfer) break;
      if (transfer.cut) libraryTransfer = null;
      send({ command: 'pasteFile', path: transfer.path, intoFolder: path, cut: transfer.cut });
      break;
    }
    case 'favorite': toggleFavorite(path, contextMenuTargetKind === 'folder' ? 'folder' : 'document'); break;
    case 'copyPath': send({ command: 'copyPath', path }); break;
    case 'reveal': send({ command: 'revealFile', path }); break;
    case 'properties': send({ command: 'showProperties', path }); break;
    case 'delete': send({ command: 'deleteFile', path }); break;
    case 'rename': openRenameBox(path); break;
  }
}
// The list this menu should show for what was right-clicked. Items that would do
// nothing are left out rather than shown dead: Paste with nothing cut, or Open
// folder over the folder you are already in.
function contextMenuEntries() {
  if (contextMenuTargetKind === 'link') {
    return tidySeparators(
      LINK_MENU_ITEMS.filter(
        (entry) => entry === 'separator' || !entry.pageOnly || isAnotherPageHref(contextMenuPath)
      ).map(labelForLinkEntry)
    );
  }
  const entries =
    contextMenuTargetKind === 'file' ? CONTEXT_MENU_ITEMS : FOLDER_MENU_ITEMS;
  return tidySeparators(
    entries
      .filter((entry) => {
        if (entry === 'separator') return true;
        if (entry.action === 'paste') return !!libraryTransfer;
        if (entry.folderOnly) return contextMenuTargetKind === 'folder';
        return true;
      })
      .map(labelForFavoriteEntry)
  );
}
// One item, both ways round: it says what the click will do, not what the file is.
function labelForFavoriteEntry(entry) {
  if (entry === 'separator' || entry.action !== 'favorite') return entry;
  if (!isFavoritePath(contextMenuPath)) return entry;
  return { action: entry.action, label: 'Unfavorite' };
}
// Open says where it is sending you when that is out of the app, so the one item
// that leaves says so before you pick it.
function labelForLinkEntry(entry) {
  if (entry === 'separator' || entry.action !== 'openLink') return entry;
  if (linkHoverKind(contextMenuPath) !== 'External site') return entry;
  return { action: entry.action, label: 'Open in browser' };
}
// A separator divides two groups, so one with nothing above it divides nothing —
// which is the rule dropping an item can break. Removing an item can leave a line
// at the top, at the bottom, or two in a row; none of those is a divider.
function tidySeparators(entries) {
  const kept = [];
  for (const entry of entries) {
    if (entry !== 'separator') {
      kept.push(entry);
      continue;
    }
    if (kept.length && kept[kept.length - 1] !== 'separator') kept.push(entry);
  }
  while (kept.length && kept[kept.length - 1] === 'separator') kept.pop();
  return kept;
}
function buildContextMenu() {
  contextMenu.textContent = '';
  const entries = contextMenuEntries();
  for (const entry of entries) {
    if (entry === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      sep.setAttribute('role', 'separator');
      contextMenu.appendChild(sep);
      continue;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'context-menu-item' + (entry.danger ? ' is-danger' : '');
    item.setAttribute('role', 'menuitem');
    item.textContent = entry.label;
    item.addEventListener('click', () => {
      const path = contextMenuPath;
      const link = contextMenuLink;
      hideContextMenu();
      if (path) runContextAction(entry.action, path, link);
    });
    contextMenu.appendChild(item);
  }
}

function clampContextMenu(x, y) {
  leafPlaceFloating(contextMenu, x, y);
}
function showContextMenu(x, y, path, kind, link) {
  // An empty path is the library's own top — the drive roots, or a vault's folder
  // seen from outside it — which is not a folder anything can be pasted into. A
  // folder row inside it still is, and still has its menu.
  if (!path) {
    return;
  }
  contextMenuPath = path;
  contextMenuTargetKind = kind || 'file';
  contextMenuLink = link || null;
  // Nothing to offer — an empty pane with nothing cut — so no empty box either.
  if (!contextMenuEntries().some((entry) => entry !== 'separator')) {
    return;
  }
  buildContextMenu();
  clampContextMenu(x, y);
  leafFocusForKeyboard(contextMenu.querySelector('.context-menu-item'));
}
document.addEventListener('contextmenu', (event) => {
  // A link in the document comes first: it is the innermost thing under the pointer
  // and none of the pane branches below know what to do with it. Not while the block
  // is being edited, where the menu you want is the one with Paste in it.
  const documentLink = documentLinkFor(event.target);
  if (documentLink && !event.target.closest('[contenteditable="true"]')) {
    event.preventDefault();
    const href = (documentLink.getAttribute('href') || '').trim();
    showContextMenu(event.clientX, event.clientY, href, 'link', documentLink);
    return;
  }
  // Closest wins, so a folder row inside the pane beats the pane itself, and the
  // pane only answers where no row did — which is exactly the empty space below
  // the last row.
  const row = event.target.closest('[data-reveal-path]');
  if (row) {
    event.preventDefault();
    const kind = row.hasAttribute('data-folder-path') ? 'folder' : 'file';
    showContextMenu(event.clientX, event.clientY, row.getAttribute('data-reveal-path'), kind);
    return;
  }
  // Anywhere else in the pane's scrolling area means the folder being browsed. It is
  // the scroll box and not the row list because the list is only as tall as its
  // rows, and the space below them is most of the pane in a small folder. It is the
  // scroll box and not the whole pane so the search field keeps its own menu, which
  // is the one with Paste for text in it.
  const editable = event.target.closest('input, textarea, [contenteditable="true"]');
  if (!editable && event.target.closest('.library-scroll')) {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, libraryFolderHere(), 'here');
    return;
  }
  hideContextMenu();
});
// On macOS a Control+click also emits a trailing left-click (ctrlKey still set)
// that would reach the dismiss handler and close the menu instantly. Swallow it
// in the capture phase; real item clicks aren't Control-held.
document.addEventListener('click', (event) => {
  if (isMacPlatform && event.ctrlKey && !contextMenu.hidden) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
window.addEventListener('click', hideContextMenu);
window.addEventListener('blur', hideContextMenu);
window.addEventListener('resize', hideContextMenu);
app.addEventListener('scroll', hideContextMenu, true);

// Inline rename: a floating input prefilled with the file name, outside the tree
// DOM so a live refresh can't clobber it. Enter commits; Escape/blur cancels.
const renameBox = document.createElement('div');
renameBox.className = 'rename-box';
renameBox.hidden = true;
const renameInput = document.createElement('input');
renameInput.type = 'text';
renameInput.className = 'rename-input';
renameInput.spellcheck = false;
renameInput.setAttribute('autocomplete', 'off');
renameInput.setAttribute('aria-label', 'Rename file');
renameBox.appendChild(renameInput);
document.body.appendChild(renameBox);
let renamePath = null;
let renameSettled = false;
function fileBaseName(path) {
  const parts = (path || '').split(/[\\/]/);
  return parts[parts.length - 1] || path || '';
}
function hideRenameBox() {
  if (renameBox.hidden) {
    return;
  }
  renameBox.hidden = true;
  renamePath = null;
}
function commitRename() {
  if (renameSettled || !renamePath) {
    return;
  }
  const path = renamePath;
  const newName = renameInput.value.trim();
  const current = fileBaseName(path);
  renameSettled = true;
  hideRenameBox();
  if (newName && newName !== current) {
    send({ command: 'renameFile', path, newName });
  }
}
function openRenameBox(path) {
  renamePath = path;
  renameSettled = false;
  const name = fileBaseName(path);
  renameInput.value = name;
  renameBox.hidden = false;
  // Anchor over the row if it is on screen, otherwise near the top of the pane.
  let row = null;
  libraryTree.querySelectorAll('[data-reveal-path]').forEach((el) => {
    if (el.getAttribute('data-reveal-path') === path) row = el;
  });
  const rect = row ? row.getBoundingClientRect() : null;
  const left = rect ? rect.left : 16;
  const top = rect ? rect.top : 80;
  renameBox.style.left = Math.max(8, Math.min(left, window.innerWidth - 248)) + 'px';
  renameBox.style.top = Math.max(8, Math.min(top, window.innerHeight - 48)) + 'px';
  renameInput.focus();
  // Preselect the name without its extension for a quick edit.
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    renameInput.setSelectionRange(0, dot);
  } else {
    renameInput.select();
  }
}
renameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitRename();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    renameSettled = true;
    hideRenameBox();
  }
});
renameInput.addEventListener('blur', () => {
  commitRename();
});
// On window, so the insert row and a rename field get Escape first.
leafOnEscape(hideContextMenu, window);
