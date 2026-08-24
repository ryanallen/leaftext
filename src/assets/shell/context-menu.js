// Right-click menu for files, folders, links, and the reading page.
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.hidden = true;
contextMenu.setAttribute('role', 'menu');
appSurface.appendChild(contextMenu);
let contextMenuPath = null;
// What was right-clicked: a file or folder in the pane, its empty space, a document link, or the document itself. It picks which list of items to show.
let contextMenuTargetKind = 'file';
// The link element itself when the menu is a link's, so Open runs the same path a plain click on it does rather than a second reading of the href.
let contextMenuLink = null;
// The words that were highlighted when this menu opened. Saved rather than reread at the moment Copy runs, because opening a menu for the keyboard moves the focus and can collapse the selection out from under it.
let contextMenuSelectionText = '';
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
// A folder, or the empty space in the pane, which stands for the folder you are browsing. No Copy path for a place you can't open as a document; Paste is the item this menu exists for.
const FOLDER_MENU_ITEMS = [
  { action: 'openFolder', label: 'Open folder', folderOnly: true },
  { action: 'favorite', label: 'Favorite', folderOnly: true },
  'separator',
  { action: 'paste', label: 'Paste' },
  'separator',
  // "Reveal folder" beside the file menu's "Reveal file" — one verb for the one action, rather than naming the file manager on each platform.
  { action: 'reveal', label: 'Reveal folder' },
  { action: 'properties', label: isMacPlatform ? 'Get Info' : 'Properties' },
];
// A link in the document being read. The two Open items and the copies are all the page can do on its own; `pageOnly` items need somewhere in the app to go, so they drop off an external link and an in-page jump.
const LINK_MENU_ITEMS = [
  { action: 'openLink', label: 'Open' },
  { action: 'openLinkInNewPage', label: 'Open in new page', pageOnly: true },
  'separator',
  { action: 'copyLink', label: 'Copy link' },
  { action: 'copyLinkText', label: 'Copy link text' },
  'separator',
  // The host resolves the href into a real path for these two; the page cannot. They want a file behind the link rather than somewhere in the app to go, so a saved page or a PDF beside the note carries them too.
  { action: 'revealLink', label: 'Reveal file', fileBehind: true },
  { action: 'copyLinkPath', label: 'Copy path', fileBehind: true },
];
// The words highlighted in the rendered document, exactly as selected, or nothing — a selection reaching outside it, or over a body standing behind another view, is not what a reader means by copy. The copy key reads this too, so the two gestures cannot disagree about which words go on the clipboard.
function selectionTextInReadingView() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  const body = app.querySelector('.document-body');
  // offsetParent is null while another view (the graph) sits in its place.
  if (!body || body.offsetParent === null) return '';
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (!body.contains(selection.getRangeAt(index).commonAncestorContainer)) return '';
  }
  return selection.toString();
}
const PAGE_MENU_ITEMS = [
  // The only item in this menu about the words rather than the file, so it leads — and with nothing highlighted it is left out entirely, the way Paste is left out of the folder menu with nothing cut, so the menu is the one that opens today.
  { action: 'copySelection', label: 'Copy', selectionOnly: true },
  'separator',
  { action: 'favorite', label: 'Favorite' },
  'separator',
  { action: 'copyPath', label: 'Copy path' },
  { action: 'reveal', label: 'Reveal file' },
  { action: 'properties', label: isMacPlatform ? 'Get Info' : 'Properties' },
  'separator',
  { action: 'delete', label: 'Delete', danger: true },
];
function hideContextMenu() {
  if (contextMenu.hidden) {
    return;
  }
  contextMenu.hidden = true;
  contextMenuPath = null;
  contextMenuLink = null;
  contextMenuSelectionText = '';
}
// What Cut or Copy last put down, so Paste has something to act on. The page holds it because the page is where it was chosen; it is not the system clipboard, so pasting here moves what you cut *here*, and a file copied in Explorer is not it.
let libraryTransfer = null;
function runContextAction(action, path, link, selected) {
  switch (action) {
    case 'open': send({ command: 'openRecent', path }); break;
    // What was saved when the menu opened, unaltered.
    case 'copySelection': copyPlainText(selected); break;
    case 'openLink': if (link) sendDocumentLink(link, false); break;
    case 'openLinkInNewPage': if (link) sendDocumentLink(link, true); break;
    // The href as it is written, not the resolved one — Copy path is the item for the file on disk.
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
      // The cut file is consumed; a copied one can be pasted again, the way every other file manager behaves.
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
    // The only item that asks. Naming the file is what makes it a question rather than a formality, and where the file goes is what makes the answer easy.
    case 'delete':
      openConfirm(
        `Delete “${fileBaseName(path)}”?`,
        isMacPlatform
          ? 'It goes to the Trash, so you can put it back.'
          : 'It goes to the Recycle Bin, so you can put it back.',
        'Delete',
        () => send({ command: 'deleteFile', path })
      );
      break;
    case 'rename': openRenameBox(path); break;
  }
}
// The list this menu should show for what was right-clicked. Items that would do nothing are left out rather than shown dead: Paste with nothing cut, or Open folder over the folder you are already in.
function contextMenuEntries() {
  if (contextMenuTargetKind === 'link') {
    return tidySeparators(
      LINK_MENU_ITEMS.filter((entry) => {
        if (entry === 'separator') return true;
        if (entry.fileBehind) return linkHasAFileBehindIt(contextMenuPath);
        return !entry.pageOnly || isAnotherPageHref(contextMenuPath);
      }).map(labelForLinkEntry)
    );
  }
  const entries = contextMenuTargetKind === 'file'
    ? CONTEXT_MENU_ITEMS
    : contextMenuTargetKind === 'page'
      ? PAGE_MENU_ITEMS
      : FOLDER_MENU_ITEMS;
  return tidySeparators(
    entries
      .filter((entry) => {
        if (entry === 'separator') return true;
        if (entry.action === 'paste') return !!libraryTransfer;
        if (entry.selectionOnly) return !!contextMenuSelectionText;
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
// Open says where it is sending you when that is out of the app, so the one item that leaves says so before you pick it.
function labelForLinkEntry(entry) {
  if (entry === 'separator' || entry.action !== 'openLink') return entry;
  if (linkHoverKind(contextMenuPath) !== 'External site') return entry;
  return { action: entry.action, label: 'Open in browser' };
}
// A separator divides two groups, so one with nothing above it divides nothing — which is the rule dropping an item can break. Removing an item can leave a line at the top, at the bottom, or two in a row; none of those is a divider.
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
      const selected = contextMenuSelectionText;
      hideContextMenu();
      if (path) runContextAction(entry.action, path, link, selected);
    });
    contextMenu.appendChild(item);
  }
}

function clampContextMenu(x, y) {
  leafPlaceFloating(contextMenu, x, y);
}
function showContextMenu(x, y, path, kind, link) {
  // An empty path is the library's own top — the drive roots, or a vault's folder seen from outside it — which is not a folder anything can be pasted into. A folder row inside it still is, and still has its menu.
  if (!path) {
    return;
  }
  contextMenuPath = path;
  contextMenuTargetKind = kind || 'file';
  contextMenuLink = link || null;
  contextMenuSelectionText = contextMenuTargetKind === 'page' ? selectionTextInReadingView() : '';
  // Nothing to offer — an empty pane with nothing cut — so no empty box either.
  if (!contextMenuEntries().some((entry) => entry !== 'separator')) {
    return;
  }
  // A right-click moves no pointer, so a card the rest before it raised is still up and nothing else takes it down. Below both returns on purpose: a menu that decides not to open leaves the card standing.
  dismissLinkHoverTip();
  buildContextMenu();
  clampContextMenu(x, y);
  leafFocusForKeyboard(contextMenu.querySelector('.context-menu-item'));
}
document.addEventListener('contextmenu', (event) => {
  // A link in the document comes first: it is the innermost thing under the pointer and none of the pane branches below know what to do with it. Not while the block is being edited, where the menu you want is the one with Paste in it.
  const documentLink = documentLinkFor(event.target);
  if (documentLink && !event.target.closest('[contenteditable="true"]')) {
    event.preventDefault();
    const href = (documentLink.getAttribute('href') || '').trim();
    showContextMenu(event.clientX, event.clientY, href, 'link', documentLink);
    return;
  }
  // Closest wins, so a folder row inside the pane beats the pane itself, and the pane only answers where no row did — which is exactly the empty space below the last row.
  const row = event.target.closest('[data-reveal-path]');
  if (row) {
    event.preventDefault();
    const kind = row.hasAttribute('data-folder-path') ? 'folder' : 'file';
    showContextMenu(event.clientX, event.clientY, row.getAttribute('data-reveal-path'), kind);
    return;
  }
  const editable = event.target.closest('input, textarea, [contenteditable="true"]');
  if (!editable && event.target.closest('.reader-layout')) {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, activeDocumentPath(), 'page');
    return;
  }
  // Anywhere else in the pane's scrolling area means the folder being browsed. It is the scroll box and not the row list because the list is only as tall as its rows, and the space below them is most of the pane in a small folder. It is the scroll box and not the whole pane so the search field keeps its own menu, which is the one with Paste for text in it.
  if (!editable && event.target.closest('.library-scroll')) {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, libraryFolderHere(), 'here');
    return;
  }
  hideContextMenu();
});
// On macOS a Control+click also emits a trailing left-click (ctrlKey still set) that would reach the dismiss handler and close the menu instantly. Swallow it in the capture phase; real item clicks aren't Control-held.
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

// Inline rename: a floating input prefilled with the file name, outside the tree DOM so a live refresh can't clobber it. Enter commits; Escape/blur cancels.
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
appSurface.appendChild(renameBox);
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
function openRenameBox(path, anchor) {
  renamePath = path;
  renameSettled = false;
  const name = fileBaseName(path);
  renameInput.value = name;
  renameBox.hidden = false;
  // Over whatever was pressed where the caller names it, else over the pane row if that is on screen, else near the top of the pane.
  let row = null;
  if (!anchor) {
    libraryTree.querySelectorAll('[data-reveal-path]').forEach((el) => {
      if (el.getAttribute('data-reveal-path') === path) row = el;
    });
  }
  const anchored = anchor || row;
  const rect = anchored ? anchored.getBoundingClientRect() : null;
  const left = rect ? rect.left : 16;
  const top = rect ? rect.top : 80;
  const at = leafClampToApp(left, top, 240, 40, 8);
  renameBox.style.left = at.left + 'px';
  renameBox.style.top = at.top + 'px';
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
// The big heading over a file that names no title of its own is the file's name, not the document's words, so pressing it renames the file through the same box a pane row opens. The renderer only states the fact; the tooltip and the press are the app's, because a published site draws the same document and can rename nothing. Called per render, so the listener dies with the heading it was put on.
function bindBorrowedTitleRename() {
  const heading = app.querySelector('.document-body [data-borrowed-title]');
  if (!heading) return;
  heading.title = 'Rename file';
  heading.addEventListener('click', () => {
    const path = activeDocumentPath();
    if (path) openRenameBox(path, heading);
  });
}
// The one question the app asks, and the only thing in it that stands in your way until you answer. The frame is declared in the boot HTML; what is asked is the caller's, so a second thing worth confirming needs no second dialog.
const confirmBackdrop = document.getElementById('confirmBackdrop');
const confirmDialog = document.getElementById('confirmDialog');
const confirmDialogTitle = document.getElementById('confirmDialogTitle');
const confirmDialogDetail = document.getElementById('confirmDialogDetail');
const confirmDialogCancel = document.getElementById('confirmDialogCancel');
const confirmDialogAccept = document.getElementById('confirmDialogAccept');
let confirmAction = null;
let confirmReturnFocus = null;
let confirmFadeTimer = 0;
function openConfirm(title, detail, acceptLabel, action) {
  confirmAction = action;
  confirmReturnFocus = document.activeElement;
  confirmDialogTitle.textContent = title;
  confirmDialogDetail.textContent = detail;
  confirmDialogAccept.textContent = acceptLabel;
  if (confirmFadeTimer) {
    clearTimeout(confirmFadeTimer);
    confirmFadeTimer = 0;
  }
  confirmBackdrop.hidden = false;
  confirmDialog.hidden = false;
  // A frame later, so the scrim has a start state to fade from — the same two steps every sheet's scrim takes.
  window.requestAnimationFrame(() => confirmBackdrop.classList.add('open'));
  // The destructive button takes the focus, so Enter answers the question that was asked rather than the button nearest the pointer.
  leafFocusForKeyboard(confirmDialogAccept);
}
// Matching the scrim's own fade: the dialog goes at once, the dim under it catches up.
const CONFIRM_FADE_MS = 160;
function closeConfirm() {
  if (confirmDialog.hidden) return;
  confirmDialog.hidden = true;
  confirmBackdrop.classList.remove('open');
  confirmFadeTimer = setTimeout(() => {
    confirmBackdrop.hidden = true;
    confirmFadeTimer = 0;
  }, CONFIRM_FADE_MS);
  confirmAction = null;
  leafFocusForKeyboard(confirmReturnFocus);
  confirmReturnFocus = null;
}
function acceptConfirm() {
  const action = confirmAction;
  closeConfirm();
  if (action) action();
}
confirmDialogCancel.addEventListener('click', closeConfirm);
confirmDialogAccept.addEventListener('click', acceptConfirm);
confirmBackdrop.addEventListener('click', closeConfirm);
// Enter answers yes, for the pointer user who was handed no focus to press it with. Not while Cancel holds the focus: a focused button's own Enter has to win, or Tab would reach a button that cannot be pressed.
window.addEventListener('keydown', (event) => {
  if (confirmDialog.hidden || event.key !== 'Enter') return;
  if (document.activeElement === confirmDialogCancel) return;
  event.preventDefault();
  acceptConfirm();
});
// On window, so the insert row and a rename field get Escape first.
leafOnEscape(hideContextMenu, window);
leafOnEscape(closeConfirm, window);
