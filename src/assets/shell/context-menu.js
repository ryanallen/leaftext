// Right-click menu for library file rows, acting on the row's path. Groups:
// open, clipboard, rename, locate, and destructive delete last.
const contextMenu = document.createElement('div');
contextMenu.className = 'context-menu';
contextMenu.hidden = true;
contextMenu.setAttribute('role', 'menu');
document.body.appendChild(contextMenu);
let contextMenuPath = null;
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const CONTEXT_MENU_ITEMS = [
  { action: 'open', labelKey: 'actions.open' },
  'separator',
  { action: 'cut', labelKey: 'actions.cut' },
  { action: 'copy', labelKey: 'actions.copy' },
  { action: 'copyPath', labelKey: 'actions.copyPath' },
  'separator',
  { action: 'rename', labelKey: 'actions.rename' },
  'separator',
  { action: 'reveal', labelKey: 'actions.revealFile' },
  { action: 'properties', labelKey: isMacPlatform ? 'actions.getInfo' : 'actions.properties' },
  'separator',
  { action: 'delete', labelKey: 'actions.delete', danger: true },
];
function hideContextMenu() {
  if (contextMenu.hidden) {
    return;
  }
  contextMenu.hidden = true;
  contextMenuPath = null;
}
function runContextAction(action, path) {
  switch (action) {
    case 'open': send({ command: 'openRecent', path }); break;
    case 'cut': send({ command: 'copyFile', path, cut: true }); break;
    case 'copy': send({ command: 'copyFile', path, cut: false }); break;
    case 'copyPath': send({ command: 'copyPath', path }); break;
    case 'reveal': send({ command: 'revealFile', path }); break;
    case 'properties': send({ command: 'showProperties', path }); break;
    case 'delete': send({ command: 'deleteFile', path }); break;
    case 'rename': openRenameBox(path); break;
  }
}
function buildContextMenu() {
  contextMenu.textContent = '';
  for (const entry of CONTEXT_MENU_ITEMS) {
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
    item.textContent = window.leafLocale.t(entry.labelKey);
    item.addEventListener('click', () => {
      const path = contextMenuPath;
      hideContextMenu();
      if (path) {
        runContextAction(entry.action, path);
      }
    });
    contextMenu.appendChild(item);
  }
}
function showContextMenu(x, y, path) {
  if (!path) {
    return;
  }
  contextMenuPath = path;
  buildContextMenu();
  contextMenu.hidden = false;
  const left = Math.max(8, Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8));
  contextMenu.style.left = left + 'px';
  contextMenu.style.top = top + 'px';
  const first = contextMenu.querySelector('.context-menu-item');
  if (first) {
    first.focus();
  }
}
document.addEventListener('contextmenu', (event) => {
  const target = event.target.closest('[data-reveal-path]');
  if (target) {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, target.getAttribute('data-reveal-path'));
  } else {
    hideContextMenu();
  }
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
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideContextMenu();
  }
});
