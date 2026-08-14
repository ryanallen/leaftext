// Which document was rendered last, so the fade below runs when the document changes and not when an inline edit commits. Only this fragment reads it, which is why it is not in state.js. `var` and not `let`: theme.js runs renderState() as it loads, which reaches the home-screen branch that clears this — and a `let` is in its dead zone until the line declaring it runs, so even the write would throw.
var lastRenderedDocumentPath = null;
// How many rows a start-screen list shows once the columns have folded. Five keeps the headline, both lists and both buttons on one screen, and the rest is one press away in the sheet. `var` for the reason above: the first render happens before this fragment has run, and it reads this.
var HOME_FOLDED_ROWS = 5;
// The fourth bottom sheet, and its own state. `var` for the same reason again.
var homeSheet = document.getElementById('homeSheet');
var homeSheetBackdrop = document.getElementById('homeSheetBackdrop');
var homeSheetBody = document.getElementById('homeSheetBody');
var homeSheetTitle = document.getElementById('homeSheetTitle');
var homeSheetClose = document.getElementById('homeSheetClose');
var homeSheetShowing = null;
var homeSheetLastFocus = null;
// How long an unfavorited file stays on screen before it really goes. The host is told at once, so nothing is riding on this timer but the chance to change your mind — and a row you can still see is a row you can still press.
var HOME_UNDO_MS = 30000;
// Favorites that have been unfavorited and are still drawn: path to its timer. Read through `homeIsDropping` — theme.js runs the first render before this line does, and a `var` is undefined until then.
var homeDropping = new Map();
function homeIsDropping(path) {
  return !!homeDropping && homeDropping.has(String(path));
}
// Favorites the host says are not on the disk, and vaults whose own folder has gone. Empty until an answer arrives, which is the true answer while the reply is in flight and the true answer in a browser, where nobody reads a disk. `var` for the reason above: the first render runs before this fragment does.
var homeMissing = new Set();
var homeMissingVaults = new Set();
// The host's answer, applied to the rows already on screen. Never a redraw: a row unfavorited with the heart is held there by its own timer, and rebuilding the list would throw its half-finished dissolve away and jump the list under the reader.
function markHomeFavorites(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-home-favorite]').forEach((row) => {
    const path = row.getAttribute('data-home-favorite') || '';
    const vault = row.getAttribute('data-home-vault');
    // A row on its way out is off the store, so it is never named missing: what the reader is watching is it leaving.
    const going = homeIsDropping(path);
    const vaultGone = !going && vault != null && homeMissingVaults.has(Number(vault));
    row.classList.toggle('is-missing', !going && (vaultGone || homeMissing.has(path)));
    // No way out on a row inside a folder that is not there: repointing one file in it is not the fix.
    row.classList.toggle('is-vault-gone', vaultGone);
  });
  root.querySelectorAll('.home-list-group[data-home-vault]').forEach((group) => {
    const vault = group.getAttribute('data-home-vault');
    group.classList.toggle('is-missing', homeMissingVaults.has(Number(vault)));
  });
}
window.leafSetFavoritesMissing = (answer) => {
  homeMissing = new Set(((answer && answer.paths) || []).map(String));
  homeMissingVaults = new Set(((answer && answer.vaults) || []).map(Number));
  markHomeFavorites(app);
  if (homeSheetShowing) markHomeFavorites(homeSheetBody);
};
// The class comes off again so a document at rest carries no animation. Guarded on the target: animation events bubble, and a rendered document animates things of its own — a table's edge bands finishing their scroll strip the fade off the page mid-way without it. A render that supersedes an unfinished one needs no undoing; the innerHTML below throws the whole layout away, listener included.
function fadeDocumentIn(layout) {
  layout.classList.add('is-arriving');
  const settled = (event) => {
    if (event.target !== layout) return;
    layout.removeEventListener('animationend', settled);
    layout.classList.remove('is-arriving');
  };
  layout.addEventListener('animationend', settled);
}
// The header's plus, for the home screen's New document button. A function, not a const: theme.js runs renderState() as it loads, long before this fragment.
function newIconSvg() {
  return `<span class="lt-icon lt-icon-new"></span>`;
}
function homeRowParts(path) {
  const raw = String(path == null ? '' : path);
  const base = raw.split(/[\\/]/).pop() || raw;
  const above = raw.slice(0, raw.length - base.length);
  // A trailing separator belongs to the split, not the folder — unless it is the whole of it, which is a file sitting at a root.
  const folder = above.replace(/[\\/]+$/, '') || above;
  return { base, folder };
}
// One row for either home list, so both draw the same thing. The row carries the path twice: `data-path` opens it and `data-reveal-path` is what the right-click menu finds a start-screen row by. `kind` is a favorite's own — a recent is always a document, so it wears no heart and passes none.
//
// A favorite row is a wrapper holding two buttons rather than one button holding a button, which is not markup: the same shape a tab already uses for its own heart.
function homeRowMarkup(path, kind, vaultId) {
  const { base, folder } = homeRowParts(path);
  const attr = escapeAttr(String(path == null ? '' : path));
  const under = folder ? `<span class="home-row-folder">${escapeText(folder)}</span>` : '';
  // The menu reads this attribute to tell a folder's items from a file's, and the click below reads it to open the pane rather than a document.
  const folderAttr = kind === 'folder' ? ` data-folder-path="${attr}"` : '';
  // The heart the tab strip already wears, and it does the same job: the column is called Favorites, so what the mark owes is that the row is a favorite — and pressing it is how a row leaves without opening the file you meant not to open.
  const going = kind ? homeIsDropping(path) : false;
  const mark = going ? 'Favorite it again' : 'Unfavorite';
  // A row on its way out says so where it usually says its path: what is about to happen matters more than where the file is, and the sentence names the way back.
  const said = going ? 'Unfavorited. This goes in a moment — press the heart to put it back.' : `Open ${attr}`;
  const open = `<button type="button" class="home-row-open" title="${going ? escapeAttr(said) : said}" data-path="${attr}"><span class="home-row-name">${documentNameMarkup(base)}</span>${under}</button>`;
  const heart = kind
    ? `<button type="button" class="home-row-heart" data-home-unfavorite="${attr}" data-home-kind="${escapeAttr(kind)}" aria-label="${mark}" title="${going ? escapeAttr(said) : mark}"><span class="lt-icon lt-icon-favorite-${going ? 'off' : 'on'}"></span></button>`
    : '';
  // Drawn on every favorite document and shown only on a row whose file has gone, so saying it has gone is a class on a row already on screen rather than a redraw. A favorite folder gets none: this opens the picker Open opens, which picks a file.
  const repair =
    kind === 'document'
      ? `<button type="button" class="home-row-repair" data-home-repair="${attr}" title="Find this file where it is now">Find it…</button>`
      : '';
  // What the answer keys on. A favorite and a recent can be the same file, so the mark needs the favorite row rather than any row wearing that path — and the row needs its own vault, because a vault whose folder has gone takes its rows with it.
  const favorite = kind ? ` data-home-favorite="${attr}"` : '';
  const vault = kind && vaultId != null ? ` data-home-vault="${escapeAttr(String(vaultId))}"` : '';
  return `<span class="home-row${going ? ' is-going' : ''}" data-reveal-path="${attr}"${folderAttr}${favorite}${vault}>${heart}${open}${repair}</span>`;
}
// One group's heading. It carries the vault it names, and the line saying that vault's own folder has gone — drawn always and shown only when the heading is marked, so a whole vault going says so once, here, rather than on every row.
function homeGroupMarkup(group) {
  const vault = group.vaultId == null ? '' : ` data-home-vault="${escapeAttr(String(group.vaultId))}"`;
  return `<li class="home-list-group"${vault}>${escapeText(group.name)}<span class="home-list-group-gone">folder missing</span></li>`;
}
// One spelling of a path, so two ways of writing the same folder compare equal — and the case rule the host's own has: ignored everywhere but a Mac, where two spellings really are two files.
function vaultPathKey(path) {
  const key = String(path == null ? '' : path).split('\\').join('/').replace(/\/+$/, '');
  return isMacPlatform ? key : key.toLowerCase();
}
// Which vault a path sits inside: the innermost vault folder holding it, or nothing. The same rule `vault_containing` matches on in `src/store/vaults.rs`, so a prefix is not a parent — `C:\Notes` must not claim `C:\Notes-old`, so what follows the root has to be a separator or nothing at all. Worked out here rather than stored, because adding a folder as a vault today should put yesterday's files under it, which a mark written when the file was opened never would.
function vaultForPath(path) {
  const key = vaultPathKey(path);
  if (!key) return null;
  let best = null;
  let deepest = 0;
  for (const vault of leafVaults) {
    const root = vaultPathKey(vault && vault.rootPath);
    if (!root || root.length < deepest) continue;
    if (key !== root && !key.startsWith(`${root}/`)) continue;
    best = vault;
    deepest = root.length;
  }
  return best;
}
// A recent is a bare path, so its vault is the folder holding it.
function recentVaultId(path) {
  const vault = vaultForPath(path);
  return vault ? vault.id : null;
}
// Either list, split by vault. In a vault that is the one you are standing in and nothing else; outside every vault it is all of them at once, since there is no current one to prefer, with the files inside no vault last — they are the leftovers rather than a vault.
function homeVaultGroups(entries, vaultIdOf) {
  if (activeVaultId) {
    const mine = entries.filter((entry) => entry != null && vaultIdOf(entry) === activeVaultId);
    return mine.length ? [{ name: libraryRootLabel(), vaultId: activeVaultId, entries: mine }] : [];
  }
  const groups = [];
  const byVault = new Map();
  for (const entry of entries) {
    if (entry == null) continue;
    const id = vaultIdOf(entry);
    if (!byVault.has(id)) {
      const vault = id == null ? null : leafVaults.find((one) => one && one.id === id);
      // A file on the desktop belongs to no vault and is still a file you favorited, and still one you were reading.
      const group = { name: vault ? vault.name : 'Outside a vault', vaultId: id, entries: [] };
      byVault.set(id, group);
      groups.push(group);
    }
    byVault.get(id).entries.push(entry);
  }
  const loose = byVault.get(null);
  return loose ? groups.filter((group) => group !== loose).concat([loose]) : groups;
}
// The rows of a grouped list. A label is only ever there to tell one group from another, so a single group carries none — which is why, in a vault, the word over the headline names it instead.
function homeGroupedRows(groups, rowMarkup) {
  const labeled = groups.length > 1;
  return groups
    .map((group) => (labeled ? homeGroupMarkup(group) : '') + group.entries.map((entry) => `<li>${rowMarkup(entry)}</li>`).join(''))
    .join('');
}
// The recents this screen is about: the current vault's own, or every vault's when you are standing outside them all.
function homeRecentScoped(recent) {
  return homeVaultGroups(recent, recentVaultId).flatMap((group) => group.entries);
}
// What would put something in an empty Recent list. Kept short: the box has no inset on its right and the pair is as wide as its widest thing, so a long line touches the border and drags both boxes out past the writing. A function, not a const: theme.js runs the first render as it loads, long before this fragment.
function homeRecentHelp() {
  return 'Files you open show up here.';
}
// The small name over the headline: a vault, Library when vaults exist, or the app with none. Both lists follow that scope, so it belongs over the screen rather than on each box.
function homeKicker() {
  return activeVaultId || leafVaults.length ? libraryRootLabel() : 'Leaftext';
}
function homeKickerMarkup() {
  const label = homeKicker();
  if (!leafVaults.length) return `<p class="kicker">${escapeText(label)}</p>`;
  const switchLabel = `Switch vault (in ${label})`;
  return `<button type="button" class="kicker library-vault-switch home-vault-switch" aria-haspopup="menu" aria-expanded="false" title="${escapeAttr(switchLabel)}" aria-label="${escapeAttr(switchLabel)}"><span class="library-crumb-caret" aria-hidden="true">▾</span>${vaultGlyph(true, activeVaultId)}${escapeText(label)}</button>`;
}
// The third way in, and only until the first vault: with one registered the word over the headline is the switcher and New vault… is one press inside it, so a permanent button would be a second way to do the same thing in the row the columns sit under. Never in a browser — both hosts refuse the command, a folder on a disk not being theirs to pick.
function homeInvitesAVault() {
  return !leafVaults.length && !window.__leafSite && !window.__leafEmbedded;
}
// The favorites as the screen draws them: what the store holds, plus every row that has been unfavorited and is still on its way out, back where it was.
function homeFavoritesDrawn(favorites) {
  if (!homeDropping || !homeDropping.size) return favorites;
  const drawn = favorites.slice();
  for (const dropped of homeDropping.values()) {
    drawn.splice(Math.min(dropped.at, drawn.length), 0, dropped.favorite);
  }
  return drawn;
}
// What one start-screen list is, said once: its name, how many it holds, how many it draws, its rows, and the line to draw instead when it has none. The column and the sheet both build from this, so a list is never a second list to learn.
function homeList(which, state) {
  if (which === 'favorites') {
    const groups = homeVaultGroups(homeFavoritesDrawn(state.favorites || []), (favorite) =>
      favorite.vaultId == null ? null : favorite.vaultId,
    );
    return {
      title: 'Favorites',
      // What the list will be, not what is on screen: a row on its way out is not one of them any more, and the count must not jump back down when it goes.
      count: groups.reduce(
        (sum, group) => sum + group.entries.filter((favorite) => !homeIsDropping(favorite.path)).length,
        0,
      ),
      drawn: groups.reduce((sum, group) => sum + group.entries.length, 0),
      rows: homeGroupedRows(groups, (favorite) => homeRowMarkup(favorite.path, favorite.kind, favorite.vaultId)),
    };
  }
  // Scoped the way Favorites is, so the two boxes on this screen are about the same vault. A recent wears no vault of its own: the group it lands in is worked out from the folder holding it, every render.
  const groups = homeVaultGroups(state.recent || [], recentVaultId);
  const count = groups.reduce((sum, group) => sum + group.entries.length, 0);
  return {
    title: 'Recent',
    count,
    drawn: count,
    rows: homeGroupedRows(groups, (path) => homeRowMarkup(path)),
    help: homeRecentHelp(),
  };
}
// The rows in a scroll box under a soft edge. The same box in the column and in the sheet — same bar, same fades — so what is read in one is what was read in the other.
function homeListBox(rows) {
  return `<div class="home-list-box"><div class="home-list-scroll leaf-scroll"><ol>${rows}</ol></div><div class="home-list-fade" aria-hidden="true"></div></div>`;
}
// The soft edges answer the scroll: one is drawn only where there really is more list past it, which is measured on the box rather than the rows because the edge is painted by a sibling of the scroller. The bar over them is every box's now, stamped by the shared watcher in `dom.js`.
function watchHomeList(box) {
  const scroll = box.querySelector('.home-list-scroll');
  if (!scroll) return;
  const edges = () => {
    box.classList.toggle('has-above', scroll.scrollTop > 1);
    box.classList.toggle('has-below', scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1);
  };
  scroll.addEventListener('scroll', edges);
  edges();
}
function watchHomeLists(root) {
  root.querySelectorAll('.home-list-box').forEach(watchHomeList);
}
// One column: a heading carrying its count, then the box — or, with nothing in it, a line saying what would put something there. The Show all button is drawn whenever the list is longer than the folded layout can hold; the stylesheet hides it wide, where the box scrolls instead. Only ever a column of a pair: with no favorites the screen is the plain list above instead.
function homeColumnMarkup(which, state) {
  const list = homeList(which, state);
  const heading = list.count ? `${escapeText(list.title)} (${escapeText(formatCount(list.count))})` : escapeText(list.title);
  // Empty is nothing left to draw, which is not the same as a count of none: the last favorite row can be on its way out and still on screen, and still pressable.
  if (!list.drawn) {
    return `<section class="home-list"><h2>${heading}</h2><p class="empty-help">${escapeText(list.help || '')}</p></section>`;
  }
  const showAll =
    list.drawn > HOME_FOLDED_ROWS
      ? `<button type="button" class="home-showall" data-home-list="${escapeAttr(which)}">Show all ${escapeText(formatCount(list.drawn))}</button>`
      : '';
  return `<section class="home-list"><h2>${heading}</h2>${homeListBox(list.rows)}${showAll}</section>`;
}
// Both lists, side by side. Neither asks the host for anything: recents and favorites already ride the payload every render reads.
//
// With no favorites there is no second column at all: a box saying how to favorite a file is an advertisement on the screen somebody sees most, and the heart is on every tab under the pointer. And one list is not half a pair — it is the plain Recent list this screen carried before there was a pair, whole paths on one line each, in the writing's own column under a rule.
function homeListsMarkup(state) {
  if (!homeList('favorites', state).drawn) {
  // Scoped too, or a vault with no favorites would be the one screen showing every other vault's files.
  const recent = homeRecentScoped(state.recent || []);
  return recent.length
      ? `<div class="recent"><h2>Recent (${escapeText(formatCount(recent.length))})</h2><ol>${recent.map((path) => `<li>${homeRowMarkup(path)}</li>`).join('')}</ol></div>`
      : `<p class="empty-help">${escapeText(homeRecentHelp())}</p>`;
  }
  return `<div class="home-list-grid">${homeColumnMarkup('recent', state)}${homeColumnMarkup('favorites', state)}</div>`;
}
// A favorite folder is not a document: it opens the library pane at that folder, which is the one place a folder can be looked at.
function openHomeFolder(path) {
  if (libraryIsClosed()) toggleLibrary();
  setLibraryFolder(path);
}
// Every row in a home list, wherever it is drawn. Rebound on each render because the screen is rebuilt whole, and again for the sheet's own copy of the same rows.
function bindHomeRows(root) {
  // The row itself is the handle, past a small threshold — no grip, which would be a fourth column on every row of a list of eight for a gesture used rarely.
  root.querySelectorAll('[data-home-favorite]').forEach((row) => {
    row.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || row.classList.contains('is-going')) return;
      // The heart and the way out are pressed, not dragged.
      if (event.target && event.target.closest && event.target.closest('.home-row-heart, .home-row-repair')) return;
      homeRowDrag = {
        path: row.getAttribute('data-home-favorite'),
        row,
        pointerId: event.pointerId,
        startY: event.clientY,
        moved: false,
      };
    });
  });
  root.querySelectorAll('[data-path]').forEach((button) => {
    button.addEventListener('click', () => {
      // The press that ended a drag is not a press on the file.
      if (suppressHomeRowClick) return;
      closeHomeSheet();
      // The folder mark is on the row, not on the button inside it.
      const row = button.closest('.home-row');
      if (row && row.hasAttribute('data-folder-path')) {
        openHomeFolder(button.dataset.path);
        return;
      }
      send({ command: 'openRecent', path: button.dataset.path });
    });
  });
  root.querySelectorAll('[data-home-unfavorite]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      pressHomeHeart(button.dataset.homeUnfavorite, button.dataset.homeKind);
    });
  });
  // The way out of a favorite whose file has moved: the picker Open opens, and the host points this entry at whatever comes back. Nothing is repointed on its own.
  root.querySelectorAll('[data-home-repair]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      send({ command: 'repointFavorite', path: button.dataset.homeRepair });
    });
  });
}
// How far the pointer goes before a press on a favorite row is a drag rather than a click. Under it the row still opens, which is what the row is for.
var HOME_DRAG_THRESHOLD = 4;
// The row under the pointer, once one is being dragged.
var homeRowDrag = null;
// A drag that ended over the row's own button: the click still comes, and it must not open the file that was just moved. Cleared the way the tab strip clears its own.
var suppressHomeRowClick = false;
// The items of a favorite row's own group: the run between the headings around it. A row never leaves the vault it was marked in — dragging it out would rename what it belongs to by accident.
function homeRowGroup(row) {
  const item = row.parentElement;
  const list = item && item.parentElement;
  if (!list || !list.children) return [];
  const items = Array.prototype.slice.call(list.children);
  const at = items.indexOf(item);
  if (at < 0) return [];
  const heading = (one) => one && one.classList && one.classList.contains('home-list-group');
  const holdsRow = (one) => !!(one && one.querySelector && one.querySelector('[data-home-favorite]'));
  const group = [];
  for (let index = at; index >= 0 && !heading(items[index]); index -= 1) {
    if (holdsRow(items[index])) group.unshift(items[index]);
  }
  for (let index = at + 1; index < items.length && !heading(items[index]); index += 1) {
    if (holdsRow(items[index])) group.push(items[index]);
  }
  return group;
}
function homeRowIn(item) {
  return item && item.querySelector ? item.querySelector('[data-home-favorite]') : null;
}
function homeRowPath(item) {
  const row = homeRowIn(item);
  return row ? row.getAttribute('data-home-favorite') : null;
}
// Which slot the row would drop into: the first neighbor whose middle the pointer has passed, and the end of the group past the last of them. Measured against positions taken before anything moved, so the rows stepping aside cannot change the answer that decided to move them.
function homeDropIndex(baselines, y) {
  const before = baselines.findIndex((middle) => y < middle);
  return before === -1 ? baselines.length : before;
}
// The row a drop lands in front of, as a path — never a position, because the drawn list is grouped and can still be showing a row that has left the store. `null` is the end of the group, and a row on its way out is stepped over: it is off the store, so the host could not find it.
function homeLandingPath(others, to) {
  for (let index = to; index < others.length; index += 1) {
    const row = homeRowIn(others[index]);
    if (row && !row.classList.contains('is-going')) return homeRowPath(others[index]);
  }
  return null;
}
// One slot: the item plus the space to its neighbor, so a row stepping aside lands exactly where the dragged one was.
function homeSlotHeight(items, index) {
  const box = items[index].getBoundingClientRect();
  const next = items[index + 1];
  if (next) return next.getBoundingClientRect().top - box.top;
  const previous = items[index - 1];
  if (previous) return box.bottom - previous.getBoundingClientRect().bottom;
  return box.height;
}
// The row lifted off the list and carried by the pointer. A copy, because the original item stays in the list holding its space — that space is the room the others open, and it wears the grain, so where the row lands is a thing you can see.
function startHomeRowGhost(drag, box) {
  const ghost = document.createElement('div');
  ghost.className = 'home-row-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.innerHTML = drag.row.outerHTML;
  ghost.style.left = box.left + 'px';
  ghost.style.top = box.top + 'px';
  ghost.style.width = box.width + 'px';
  appSurface.appendChild(ghost);
  drag.ghost = ghost;
}
// Open the gap where the row would land: everything between its own slot and that one steps one slot the other way, and the empty slot travels with them. A transform, so nothing reflows and every step eases on the app's own curve.
function slideHomeRowsAside(drag) {
  drag.others.forEach((item, index) => {
    let shift = 0;
    if (index >= drag.from && index < drag.to) shift = -drag.span;
    else if (index < drag.from && index >= drag.to) shift = drag.span;
    item.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
  });
  const moved = (drag.to - drag.from) * drag.span;
  drag.item.style.transform = moved ? 'translateY(' + moved + 'px)' : '';
}
// Past the threshold: measure the group before anything moves, lift the copy, and leave the empty slot behind wearing the grain.
function beginHomeRowDrag(drag, event) {
  const items = homeRowGroup(drag.row);
  const item = drag.row.parentElement;
  const from = items.indexOf(item);
  if (from < 0) return false;
  const others = items.filter((one) => one !== item);
  drag.moved = true;
  drag.item = item;
  drag.others = others;
  drag.from = from;
  drag.to = from;
  drag.span = homeSlotHeight(items, from);
  drag.baselines = others.map((one) => {
    const box = one.getBoundingClientRect();
    return box.top + box.height / 2;
  });
  const box = drag.row.getBoundingClientRect();
  drag.grabOffset = event.clientY - box.top;
  // Held here and not on the press: a captured pointer sends the click that follows to whatever holds the capture, so capturing on every press takes the click off the button inside the row and the row stops opening its file. Past the threshold there is no click left to lose.
  leafHoldPointer(drag.row, drag.pointerId);
  startHomeRowGhost(drag, box);
  drag.item.classList.add('is-dropzone');
  drag.row.classList.add('is-dragging');
  document.body.classList.add('is-home-row-dragging');
  return true;
}
function endHomeRowDrag() {
  if (!homeRowDrag) return;
  const drag = homeRowDrag;
  homeRowDrag = null;
  leafReleasePointer(drag.row, drag.pointerId);
  if (!drag.moved) return;
  drag.row.classList.remove('is-dragging');
  drag.item.classList.remove('is-dropzone');
  document.body.classList.remove('is-home-row-dragging');
  if (drag.ghost) drag.ghost.remove();
  drag.item.style.transform = '';
  drag.others.forEach((one) => {
    one.style.transform = '';
  });
  suppressHomeRowClick = true;
  setTimeout(() => {
    suppressHomeRowClick = false;
  }, 0);
  if (drag.to !== drag.from) dropHomeRow(drag.path, homeLandingPath(drag.others, drag.to));
}
function dropHomeRow(path, before) {
  if (!path || before === path) return;
  send({ command: 'moveFavorite', path, before: before == null ? null : before });
}
document.addEventListener('pointermove', (event) => {
  if (!homeRowDrag || event.pointerId !== homeRowDrag.pointerId) return;
  if (!homeRowDrag.moved) {
    if (Math.abs(event.clientY - homeRowDrag.startY) < HOME_DRAG_THRESHOLD) return;
    if (!beginHomeRowDrag(homeRowDrag, event)) {
      homeRowDrag = null;
      return;
    }
  }
  // The copy goes with the pointer; the list makes room under it.
  homeRowDrag.ghost.style.top = event.clientY - homeRowDrag.grabOffset + 'px';
  const to = homeDropIndex(homeRowDrag.baselines, event.clientY);
  if (to === homeRowDrag.to) return;
  homeRowDrag.to = to;
  slideHomeRowsAside(homeRowDrag);
});
document.addEventListener('pointerup', endHomeRowDrag);
document.addEventListener('pointercancel', endHomeRowDrag);
// The heart on a favorite row. Pressing it drops the file at once — the host is told, and a crash between here and the wait ending must not put it back — but the row stays on screen, dimmed, so the press can be taken back. Pressing it again inside the wait re-marks the file and puts the row back the way it was.
function pressHomeHeart(path, kind) {
  const key = String(path || '');
  if (!key) return;
  const dropped = homeDropping.get(key);
  if (dropped) {
    clearTimeout(dropped.timer);
    homeDropping.delete(key);
    // Flips the page's own copy and redraws before the host answers, exactly as the tab's heart does — so the row fills back in under the pointer.
    toggleFavorite(key, kind);
    renderState();
    return;
  }
  const favorites = currentFavorites();
  const at = favorites.findIndex((one) => one && one.path === key);
  if (at < 0) return;
  homeDropping.set(key, {
    at,
    favorite: favorites[at],
    timer: setTimeout(() => endHomeDrop(key), HOME_UNDO_MS),
  });
  toggleFavorite(key, kind);
  renderState();
}
// The wait is over. The row dissolves and the ones under it close the gap, and only then does it leave the markup — a row that vanished on the frame the timer fired would take the rows below up with it in one jump.
function endHomeDrop(key) {
  const dropped = homeDropping.get(key);
  if (!dropped) return;
  homeDropping.delete(key);
  const going = app.querySelectorAll('.home-row.is-going');
  let leaving = null;
  going.forEach((row) => {
    if (row.getAttribute('data-reveal-path') === key) leaving = row;
  });
  const li = leaving && leaving.parentElement;
  if (!li) {
    renderState();
    return;
  }
  li.classList.add('is-leaving');
  const settled = () => {
    li.removeEventListener('transitionend', settled);
    renderState();
  };
  li.addEventListener('transitionend', settled);
}
function onHomeSheetKey(event) {
  if (event.key === 'Escape') closeHomeSheet();
}
// The folded list, given the window. On the pattern the other three sheets share, so the grip, the scrim, the drag and the Escape are all the ones already here.
function openHomeSheet(which) {
  const list = homeList(which, currentState || {});
  homeSheetShowing = which;
  homeSheetTitle.textContent = list.count ? `${list.title} (${formatCount(list.count)})` : list.title;
  homeSheet.setAttribute('aria-label', list.title);
  homeSheetBody.innerHTML = homeListBox(list.rows);
  bindHomeRows(homeSheetBody);
  watchHomeLists(homeSheetBody);
  markHomeFavorites(homeSheetBody);
  if (homeSheet.hidden) homeSheetLastFocus = document.activeElement;
  openSheet(homeSheet, homeSheetBackdrop);
  document.addEventListener('keydown', onHomeSheetKey);
  leafFocusForKeyboard(homeSheetClose);
}
function closeHomeSheet(options) {
  if (!homeSheet || homeSheet.hidden) return;
  homeSheetShowing = null;
  document.removeEventListener('keydown', onHomeSheetKey);
  closeSheet(homeSheet, homeSheetBackdrop, options);
  leafFocusForKeyboard(homeSheetLastFocus);
}
if (homeSheet) {
  makeSheetDraggable(homeSheet, homeSheet.querySelector('.leaf-sheet-grip'), closeHomeSheet);
  // Wrapped, not handed straight over: the close reads how the sheet was dismissed off its one argument, and a listener would pass it the click.
  homeSheetClose.addEventListener('click', () => closeHomeSheet());
  homeSheetBackdrop.addEventListener('click', () => closeHomeSheet());
}
// Is the start screen what is on the page? Not the same question as "is there a document": a tab opened straight into source leaves the page's copy of the state with no document on it, so that alone would draw the start screen over somebody's source and throw its editor away. The map needs no clause — it hides `app` and closes whenever a state arrives with no document.
function homeScreenIsShowing() {
  return !!currentState && !currentState.document && !codeViewActive;
}
function renderState() {
  const state = currentState || { recent: [], favorites: [], tabs: [], active: null, document: null };
  disconnectMinimapPreviewObservers();
  disconnectReaderReflowObserver();
  cancelReaderScrollSettle();
  // The full-window diagram lives inside `app`, so the render below would take it away with nothing knowing — including the Escape handler still listening.
  closeDiagramOverlay();
  // The hover card floats beside `app`, so the render below would strand it over a page it does not describe.
  dismissLinkHoverTip();
  readerAnchorBlocks = null;
  // Any full render shows the reading view, so we're no longer in the code view.
  codeViewActive = false;
  disposeMonacoEditor();
  document.documentElement.dataset.codeView = 'false';
  renderTabs(state);
  if (state.document) {
    document.title = `${state.document.title} - Leaftext`;
    const renderedPath = state.document.path || activeDocumentPath();
    const arriving = renderedPath !== lastRenderedDocumentPath;
    lastRenderedDocumentPath = renderedPath;
    app.className = 'reader-shell has-document';
    const minimapHtml = renderDocumentMinimap(state.document.minimap);
    const layoutClass = minimapHtml ? 'reader-layout' : 'reader-layout reader-layout-no-minimap';
    // Carry the scroll origin onto the fresh body — losing it shifts the layout by the origin and the anchor restore lands off by exactly that.
    const previousBody = app.querySelector('.document-body');
    const previousScrollOrigin = previousBody ? previousBody.style.getPropertyValue('--reader-scroll-origin') : '';
    // Hidden, then revealed already decorated: mutating a laid-out document makes every insertion invalidate everything after it. None of the passes below read geometry, so having none yet costs nothing.
    app.innerHTML = `<div class="${layoutClass}" style="display:none">${state.document.html}</div>`;
    const readerLayout = app.firstElementChild;
    setMinimapMarkup(minimapHtml);
    if (previousScrollOrigin) {
      const freshBody = app.querySelector('.document-body');
      if (freshBody) freshBody.style.setProperty('--reader-scroll-origin', previousScrollOrigin);
    }
    // Fresh epoch per render, so a reopened document never shows a cached image.
    localImageEpoch += 1;
    stampLocalImages();
    laneWideTables();
    laneWidePictures();
    bindImageSheet();
    decorateBlockquoteLines();
    buildDocumentOutline();
    decorateCodeBlocks();
    // Only on arrival: a re-render after a commit or a live reload would growl again about a note the reader was already told about.
    if (arriving) applyFrontmatterAsks(readerLayout);
    applySpeedReaderToDocument();
    // The caret waits for the reveal below: focus() does nothing on a hidden element, so a commit's caret would be dropped rather than restored.
    bindReadingEditor(state.document, { deferCaret: true });
    // One style pass and one layout, for the finished document.
    if (readerLayout) {
      readerLayout.style.removeProperty('display');
      if (arriving) fadeDocumentIn(readerLayout);
    }
    // Past this line the document has geometry, so anything that measures it, or renders by measuring text, or wants focus, is safe.
    placeDeferredReadingCaret();
    bindDocumentLinks();
    requestDocumentPager(state.document.path || activeDocumentPath());
    bindDocumentMinimap();
    renderMermaidDiagrams();
    renderMathElements();
    observeReaderReflow();
    scheduleMinimapPreviewUpdate();
    // Returning from the code view: land on the block holding the source line the code view was scrolled to. This wins over the reset-to-top the host's Reset intent would otherwise run.
    const exactRestore = takeExactViewRestore(state.document.path || activeDocumentPath());
    if (exactRestore) {
      // The code view never moved, so take the pixel back rather than re-derive it from a block — that rounds backwards and walks up over repeated toggles.
      pendingViewAtTop = false;
      pendingReadingSrcOffset = null;
      pendingViewScrollFraction = null;
      resetReaderScrollOnNextRender = false;
      window.requestAnimationFrame(() => {
        setReaderScrollTop(exactRestore.readerScrollTop);
        recordReaderLanded();
        readerScrollAnchor = captureReaderScrollAnchor();
        updateMinimapViewport();
      });
    } else if (pendingViewAtTop) {
      // Toggled from the very top of the code view: land flush at the reader's content start, not aligned on the first block below its top padding.
      pendingViewAtTop = false;
      pendingReadingSrcOffset = null;
      resetReaderScrollOnNextRender = false;
      resetReaderScrollToContentStart();
    } else if (pendingReadingSrcOffset != null) {
      const srcOffset = pendingReadingSrcOffset;
      pendingReadingSrcOffset = null;
      resetReaderScrollOnNextRender = false;
      // Keep the fraction only as this landing's fallback; a later unrelated render must not inherit it and scroll a fresh document part-way down.
      const fallbackFraction = pendingViewScrollFraction;
      pendingViewScrollFraction = null;
      window.requestAnimationFrame(() => {
        if (!scrollReadingToSrcOffset(srcOffset)) {
          pendingViewScrollFraction = fallbackFraction;
          resetReaderScrollToContentStart();
          return;
        }
        recordReaderLanded();
        readerScrollAnchor = captureReaderScrollAnchor();
        updateMinimapViewport();
      });
    } else if (resetReaderScrollOnNextRender) {
      resetReaderScrollOnNextRender = false;
      resetReaderScrollToContentStart();
    } else {
      updateMinimapViewport();
    }
    updateEditingChrome();
    return;
  }
  resetReaderScrollOnNextRender = false;
  // Back to the home screen, so the next document is an arrival even if it is the one just closed.
  lastRenderedDocumentPath = null;
  document.title = 'Leaftext';
  app.className = 'reader-shell empty';
  // No document, no rail — and the shell's column collapses with it.
  setMinimapMarkup('');
  updateEditingChrome();
  const invite = homeInvitesAVault();
  app.innerHTML = `
    <section class="empty-state">
      ${homeKickerMarkup()}
      <h1>${escapeText(homeMessage.hero)}</h1>
      <p class="empty-subtitle">${escapeText(homeMessage.subtitle)}</p>
      <p class="empty-description">${escapeText(homeMessage.description)}</p>
      <div class="empty-actions">
        <button type="button" class="primary-open">Choose file</button>
        <button type="button" class="primary-new">${newIconSvg()}New document</button>
        ${invite ? '<button type="button" class="primary-vault">Add your notes folder</button>' : ''}
      </div>
      ${invite ? '<p class="empty-vault-help">One folder of notes gives you search across all of it, a map of how they link, and the folder in the side pane.</p>' : ''}
      ${homeListsMarkup(state)}
      <!-- In the template, not filled in later: this screen is rebuilt on every
           home render, so an element found once at load is gone by the second. -->
      <p class="empty-version">${LEAF_VERSION ? `v${escapeText(LEAF_VERSION)}` : ''}</p>
    </section>`;
  app.querySelector('.primary-open').addEventListener('click', () => send({ command: 'open' }));
  app.querySelector('.primary-new').addEventListener('click', () => send({ command: 'newDocument' }));
  const primaryVault = app.querySelector('.primary-vault');
  if (primaryVault) primaryVault.addEventListener('click', () => send({ command: 'createVault' }));
  const homeVaultSwitch = app.querySelector('.home-vault-switch');
  if (homeVaultSwitch) bindVaultSwitch(homeVaultSwitch, false);
  bindHomeRows(app);
  watchHomeLists(app);
  // The last answer, back on the fresh rows, so a heart press does not unmark the column for as long as the next answer takes — then ask again, because the disk is the answer and only the binary can read it.
  markHomeFavorites(app);
  if (app.querySelector('[data-home-favorite]')) send({ command: 'checkFavorites' });
  app.querySelectorAll('[data-home-list]').forEach((button) => {
    button.addEventListener('click', () => openHomeSheet(button.dataset.homeList));
  });
  // A list that changed under an open sheet — a file favorited from its own right-click menu — has to change in the sheet too, or the two disagree about one list.
  if (homeSheetShowing) openHomeSheet(homeSheetShowing);
}
function renderNavigation() {
  // A published site has no strip to draw a state on: see dom.js.
  if (!backButton || !forwardButton) {
    return;
  }
  backButton.disabled = !navigationState.canGoBack;
  forwardButton.disabled = !navigationState.canGoForward;
}
function sameDocumentFragmentHref(rawHref) {
  if (rawHref.startsWith('#')) {
    return rawHref;
  }
  if (rawHref.startsWith('./#')) {
    return rawHref.slice(2);
  }
  if (rawHref.startsWith('.#')) {
    return rawHref.slice(1);
  }
  return null;
}
