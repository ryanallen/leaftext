// Vaults, the switcher between them, and the Recent list each one scopes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  fakeElement,
  homeStand,
  record,
  root,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;
  const { homeListsMarkup, homeRowMarkup } = booted;
  const { withVaults, VAULTS, KEPT, RECENT, drawnColumn, answerMissing } = homeStand(booted);

  check('a home row reads as a name over its folder', () => {
    const path = 'C:\\Users\\me\\Vault\\Journal\\A note.md';
    const row = homeRowMarkup(path);
    if (!/<span class="home-row-name"><span class="file-name-stem">A note<\/span><span class="file-type-badge">MD<\/span><\/span>/.test(row)) {
      throw new Error(`the first line is not the name and type: ${row}`);
    }
    if (!/<span class="home-row-folder">C:\\Users\\me\\Vault\\Journal<\/span>/.test(row)) {
      throw new Error(`the second line is not the folder holding it: ${row}`);
    }
    // The name comes first, or the folder is what the eye lands on.
    if (row.indexOf('home-row-name') > row.indexOf('home-row-folder')) {
      throw new Error('the folder is drawn above the name');
    }
    for (const attribute of ['data-path', 'data-reveal-path']) {
      if (!row.includes(`${attribute}="C:\\Users\\me\\Vault\\Journal\\A note.md"`)) {
        throw new Error(`the row dropped ${attribute}, so nothing can find it by path`);
      }
    }
    if (!row.includes('title="Open C:\\Users\\me\\Vault\\Journal\\A note.md"')) {
      throw new Error(`the whole path is no longer the row's tooltip: ${row}`);
    }
    // A recent has nothing to unmark, so it carries one button and no heart.
    if ((row.match(/<button/g) || []).length !== 1) {
      throw new Error(`a recent row should be one button: ${row}`);
    }
  });

  check('a home row with nothing above it draws one line', () => {
    const bare = homeRowMarkup('notes.md');
    if (bare.includes('home-row-folder')) {
      throw new Error(`a path with no folder above it drew a second line: ${bare}`);
    }
    if (!/<span class="home-row-name"><span class="file-name-stem">notes<\/span><span class="file-type-badge">MD<\/span><\/span>/.test(bare)) {
      throw new Error(`a bare name lost its name: ${bare}`);
    }
    // Only a document extension comes off. A name the app cannot open keeps every character it has, or the row says a file is called something it is not.
    const kept = homeRowMarkup('/home/me/archive.tar.gz');
    if (!/<span class="home-row-name"><span class="file-name-stem">archive\.tar\.gz<\/span><\/span>/.test(kept)) {
      throw new Error(`a name with no document extension was trimmed anyway: ${kept}`);
    }
    if (!/<span class="home-row-folder">\/home\/me<\/span>/.test(kept)) {
      throw new Error(`the folder line lost its path: ${kept}`);
    }
    // A file at a root: the separator is the whole folder, so it stays rather than emptying the line.
    const root = homeRowMarkup('/notes.md');
    if (!/<span class="home-row-folder">\/<\/span>/.test(root)) {
      throw new Error(`a file at a root lost its folder line: ${root}`);
    }
  });



  check('outside a vault every vault shows at once, labeled', () => {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    const groups = [...markup.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((m) => m[1]);
    // One per vault the kept paths name, plus one for the paths inside none — a file on the desktop is still a file you kept.
    if (groups.join('|') !== 'Dharma|Work|Outside a vault') {
      throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
    }
    if (!markup.includes('Favorites (4)')) {
      throw new Error(`the heading lost its count: ${markup}`);
    }
    // Every favorite row wears the heart, whatever it points at: the column says it is kept, and that is the fact the mark owes. It is a button, because pressing it is how a row leaves without opening the file you were trying not to open.
    const folderRow = markup.slice(markup.indexOf('data-folder-path'));
    if ((markup.match(/lt-icon-favorite-on/g) || []).length !== 4) {
      throw new Error(`a favorite row drew no heart: ${markup}`);
    }
    if (markup.includes('lt-icon-leaf') || markup.includes('lt-icon-folder')) {
      throw new Error('a favorite row is back to saying what kind of thing it points at');
    }
    if ((markup.match(/data-home-unfavorite=/g) || []).length !== 4) {
      throw new Error('a favorite row drew its heart as a mark rather than a control');
    }
    if (!markup.includes('data-home-unfavorite="C:\\Vaults\\Dharma\\Journal" data-home-kind="folder"')) {
      throw new Error(`the heart does not carry its own path and kind: ${markup}`);
    }
    if (!folderRow.startsWith('data-folder-path="C:\\Vaults\\Dharma\\Journal"')) {
      throw new Error(`the folder row does not carry its own path: ${folderRow.slice(0, 120)}`);
    }
  });

  check('inside a vault only that vault shows, with no label', () => {
    const markup = withVaults(VAULTS, 2, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    if (markup.includes('home-list-group')) {
      throw new Error('one group was labeled anyway — there is nothing to tell it from');
    }
    if (!markup.includes('Standup')) throw new Error("the vault you are in lost its own kept file");
    if (markup.includes('A sutta') || markup.includes('Loose')) {
      throw new Error('another vault leaked into the column');
    }
    if (!markup.includes('Favorites (1)')) throw new Error(`the count is not this vault's: ${markup}`);
  });


  // The page's rule, held to the host's: the same four cases `a_file_is_owned_by_the_innermost_vault_that_holds_it` pins for `vault_containing` in `src/store/tests.rs`. A recent carries no vault, so this is the whole of how its column knows which one it is in.
  check('a recent belongs to the innermost vault whose folder holds it', () => {
    const nested = [
      { id: 1, name: 'Dharma', rootPath: 'C:\\Vaults\\Dharma' },
      { id: 2, name: 'Empty Guru', rootPath: 'C:\\Vaults\\Dharma\\Emptyguru' },
      { id: 3, name: 'Elsewhere', rootPath: 'C:\\Vaults\\Elsewhere' },
    ];
    const owner = (path) =>
      withVaults(nested, 0, () => {
        const vault = booted.vaultForPath(path);
        return vault ? vault.id : null;
      });
    // Nested: the innermost wins, which is the vault the file actually lives in.
    if (owner('C:\\Vaults\\Dharma\\Emptyguru\\site\\index.md') !== 2) {
      throw new Error('a file in a nested vault went to the vault around it');
    }
    // Above the inner one, still inside the outer.
    if (owner('C:\\Vaults\\Dharma\\notes.md') !== 1) throw new Error('a file above the nested vault lost its own');
    // A prefix is not a parent.
    if (owner('C:\\Vaults\\Dharma-old\\stale.md') !== null) throw new Error('a lookalike sibling folder was claimed');
    // Nothing owns a file outside every vault: that is the whole library.
    if (owner('C:\\Vaults\\loose.md') !== null) throw new Error('a file outside every vault was claimed');
    // And the same file under either spelling is the same file, off a Mac.
    if (owner('c:/vaults/dharma/notes.md') !== 1) throw new Error('another spelling of the same folder missed');
  });

  check('inside a vault Recent is that vault too, so both boxes are about one vault', () => {
    const markup = withVaults(VAULTS, 2, () => homeListsMarkup({ recent: RECENT, favorites: KEPT }));
    if (!markup.includes('Recent (2)')) throw new Error(`the count is not this vault's: ${markup}`);
    if (markup.includes('Today') || markup.includes('Loose')) {
      throw new Error(`another vault leaked into Recent: ${markup}`);
    }
    if (!markup.includes('Roadmap')) throw new Error("this vault lost a file it holds deeper down");
    // One group each, and a single group draws no label — which is what phase 2's heading answers.
    if (markup.includes('home-list-group')) throw new Error('one group was labeled anyway');
    if (!markup.includes('Favorites (1)')) throw new Error('the box beside it stopped agreeing');
  });

  check('outside a vault Recent groups by vault, with the files in none last', () => {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: RECENT, favorites: KEPT }));
    const column = markup.slice(0, markup.indexOf('Favorites ('));
    const groups = [...column.matchAll(/<li class="home-list-group"[^>]*>([^<]*)</g)].map((one) => one[1]);
    // In the order the list already had, since a recent list is a record of what happened — and the leftovers after the vaults, because they are not one.
    if (groups.join('|') !== 'Work|Dharma|Outside a vault') {
      throw new Error(`the groups came out as ${JSON.stringify(groups)}`);
    }
    if (!markup.includes('Recent (4)')) throw new Error(`nothing is hidden outside a vault: ${markup}`);
    // The heading carries its vault, which is what the missing-folder answer is applied to.
    if (!column.includes('data-home-vault="2"')) throw new Error(`a Recent heading lost its vault: ${column}`);
  });

  check('a vault whose folder has gone marks its Recent heading as well as its Favorites one', () => {
    const markup = withVaults(VAULTS, 0, () => homeListsMarkup({ recent: RECENT, favorites: KEPT }));
    const split = markup.indexOf('Favorites (');
    const recent = drawnColumn(markup.slice(0, split));
    const favorites = drawnColumn(markup.slice(split));
    answerMissing(recent, [], [1]);
    answerMissing(favorites, [], [1]);
    if (!recent.group(1).classList.contains('is-missing')) {
      throw new Error("the Recent heading said nothing while the box beside it said the folder had gone");
    }
    if (!favorites.group(1).classList.contains('is-missing')) throw new Error("the Favorites heading lost its mark");
    if (recent.group(2).classList.contains('is-missing')) throw new Error('a vault that is there was marked too');
  });

  check('with no favorites in this vault the plain list is scoped too', () => {
    const plain = withVaults(VAULTS, 2, () => homeListsMarkup({ recent: RECENT, favorites: [] }));
    if (!plain.startsWith('<div class="recent"><h2>Recent (2)</h2><ol>')) {
      throw new Error(`the lone list is not this vault's: ${plain}`);
    }
    if (plain.includes('Today') || plain.includes('Loose')) {
      throw new Error(`the lone list showed another vault's files: ${plain}`);
    }
  });

  check('the home vault switcher opens the pane list and closes before a vault redraw', () => {
    const button = fakeElement('homeVaultSwitch');
    button.classList.add('library-vault-switch', 'home-vault-switch');
    booted.bindVaultSwitch(button, false);
    const press = button.listeners.get('pointerdown')[0];
    const event = { button: 0, stopPropagation() {}, preventDefault() {} };
    booted.leafSetVaults({ vaults: VAULTS, active: 1 });
    press(event);
    if (vm.runInContext('crumbMenu.hidden', booted) || vm.runInContext('crumbMenuOwner', booted) !== button) {
      throw new Error('the home word did not open the vault list under itself');
    }
    press(event);
    if (!vm.runInContext('crumbMenu.hidden', booted)) throw new Error('the home word did not close its open list');
    press(event);
    booted.leafSetVaults({ vaults: VAULTS, active: 2 });
    if (!vm.runInContext('crumbMenu.hidden', booted) || vm.runInContext('crumbMenuOwner', booted) !== null) {
      throw new Error('a vault redraw left a list anchored on the home word that is gone');
    }
    booted.leafSetVaults({ vaults: [], active: 0 });
  });

  check('leaving the window closes a list of vaults and leaves a vault settings panel standing', () => {
    // Another program's window coming forward, which is all a blur is.
    const leaveTheWindow = () => {
      for (const handler of [...(booted.window.__windowListeners.get('blur') || [])]) handler({});
    };
    const button = fakeElement('libraryVaultSwitch');
    button.classList.add('library-vault-switch');
    booted.bindVaultSwitch(button, false);
    const press = button.listeners.get('pointerdown')[0];
    const event = { button: 0, stopPropagation() {}, preventDefault() {} };
    booted.leafSetVaults({ vaults: VAULTS, active: 1 });

    press(event);
    if (vm.runInContext('crumbMenu.hidden', booted)) throw new Error('the switcher did not open its list of vaults');
    leaveTheWindow();
    // A list is a menu: one press from coming back, and leaving it hanging over a window nobody is in is the odd behavior.
    if (!vm.runInContext('crumbMenu.hidden', booted)) throw new Error('a list of vaults outlived the window it hangs in');

    press(event);
    const row = vm.runInContext('vaultMenuItems()', booted).find((one) => one && one.edit);
    if (!row) throw new Error('no vault row offers its own settings');
    row.edit();
    if (vm.runInContext('crumbMenu.hidden', booted) || !vm.runInContext('crumbMenuVault', booted)) {
      throw new Error("the settings button did not open that vault's settings panel");
    }
    leaveTheWindow();
    // The panel is a place work is done, and its own rows send the reader to a browser and then ask them to paste what it gives them back in here -- so closing it on the way out takes away the field they were sent to fill.
    if (vm.runInContext('crumbMenu.hidden', booted)) {
      throw new Error('a vault settings panel shut itself when the window lost focus, with nobody pressing anything');
    }

    vm.runInContext('hideCrumbMenu()', booted);
    booted.leafSetVaults({ vaults: [], active: 0 });
  });

  // A cloud client found while the list is open swaps each row's mark where it stands rather than rebuilding the list under the pointer. Both callers once looked for an `svg`, found a masked span, and swapped nothing — which is why a vault on GitHub kept its box.
  check('a vault in a cloud folder swaps its box for a cloud where the row stands', () => {
    const button = fakeElement('libraryVaultSwitch');
    button.classList.add('library-vault-switch');
    booted.bindVaultSwitch(button, false);
    const press = button.listeners.get('pointerdown')[0];
    booted.leafSetVaults({ vaults: VAULTS, active: 1 });
    press({ button: 0, stopPropagation() {}, preventDefault() {} });
    const menu = vm.runInContext('crumbMenu', booted);
    const rowFor = (id) => menu.querySelectorAll('.crumb-menu-item[data-vault-id]').find((one) => Number(one.dataset.vaultId) === id);
    try {
      if (!rowFor(1) || !rowFor(2)) throw new Error('the list of vaults drew no row for one of them');
      if (!rowFor(2).innerHTML.includes('lt-icon-package')) throw new Error(`a vault on this machine does not wear the box: ${rowFor(2).innerHTML}`);
      booted.window.leafSetCloudFolders([{ path: 'C:\\Vaults\\Work' }]);
      const swapped = rowFor(2).innerHTML;
      if (swapped.includes('lt-icon-package')) throw new Error(`the vault in a cloud folder kept its box: ${swapped}`);
      if (!swapped.includes('lt-icon-cloud')) throw new Error(`the vault in a cloud folder wears nothing: ${swapped}`);
      // One glyph, not two: the swap replaces the mark rather than writing a second one beside it.
      if (rowFor(2).querySelectorAll('.lt-icon').length !== 1) throw new Error('the row came back wearing two marks');
      // The vault that is not in one is left alone, and the open one keeps the open box.
      if (!rowFor(1).innerHTML.includes('lt-icon-package-open')) throw new Error(`the vault outside every cloud folder lost its own mark: ${rowFor(1).innerHTML}`);
    } finally {
      booted.window.leafSetCloudFolders([]);
      vm.runInContext('hideCrumbMenu()', booted);
      booted.leafSetVaults({ vaults: [], active: 0 });
    }
  });

  check('the home vault switcher keeps the regular marks and leaves room before its name', () => {
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    const switcher = (css.split('\n.library-vault-switch {\n')[1] || '').split('}')[0];
    const edge = /\n {2}padding: 0 (var\(--lt-space-\d+\));\n/.exec(switcher);
    if (!edge) throw new Error('the vault switcher no longer pays one token either side');
    // Read against the switcher's own padding rather than spelled out here: the start screen's copy cancels it, and a value written twice drifts.
    const home = css.split('.home-vault-switch {')[1];
    if (!home || !home.startsWith(`\n  margin-left: calc(-1 * ${edge[1]});\n  gap: var(--lt-space-4);`)) {
      throw new Error(`the home switcher does not cancel the switcher's own ${edge[1]} of padding, or does not leave room between its icon and name`);
    }
    if (css.includes('.home-vault-switch .lt-icon-')) {
      throw new Error('the home switcher still replaces its regular vault marks with heavier ones');
    }
  });
}
