// Vaults, the switcher between them, and the Recent list each one scopes.

import { join } from 'node:path';
import vm from 'node:vm';
import { check, fakeElement, homeStand, readingCss, record, runShell, source } from './shared.mjs';

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
    if (groups.join('|') !== 'Meadow|Work|Outside a vault') {
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
    if (!markup.includes('data-home-unfavorite="C:\\Vaults\\Meadow\\Journal" data-home-kind="folder"')) {
      throw new Error(`the heart does not carry its own path and kind: ${markup}`);
    }
    if (!folderRow.startsWith('data-folder-path="C:\\Vaults\\Meadow\\Journal"')) {
      throw new Error(`the folder row does not carry its own path: ${folderRow.slice(0, 120)}`);
    }
  });

  check('inside a vault only that vault shows, with no label', () => {
    const markup = withVaults(VAULTS, 2, () => homeListsMarkup({ recent: [], favorites: KEPT }));
    if (markup.includes('home-list-group')) {
      throw new Error('one group was labeled anyway — there is nothing to tell it from');
    }
    if (!markup.includes('Standup')) throw new Error("the vault you are in lost its own kept file");
    if (markup.includes('A survey') || markup.includes('Loose')) {
      throw new Error('another vault leaked into the column');
    }
    if (!markup.includes('Favorites (1)')) throw new Error(`the count is not this vault's: ${markup}`);
  });


  // The page's rule, held to the host's: the same four cases `a_file_is_owned_by_the_innermost_vault_that_holds_it` pins for `vault_containing` in `src/store/tests.rs`. A recent carries no vault, so this is the whole of how its column knows which one it is in.
  check('a recent belongs to the innermost vault whose folder holds it', () => {
    const nested = [
      { id: 1, name: 'Meadow', rootPath: 'C:\\Vaults\\Meadow' },
      { id: 2, name: 'Empty Guru', rootPath: 'C:\\Vaults\\Meadow\\Emptyguru' },
      { id: 3, name: 'Elsewhere', rootPath: 'C:\\Vaults\\Elsewhere' },
    ];
    const owner = (path) =>
      withVaults(nested, 0, () => {
        const vault = booted.vaultForPath(path);
        return vault ? vault.id : null;
      });
    // Nested: the innermost wins, which is the vault the file actually lives in.
    if (owner('C:\\Vaults\\Meadow\\Emptyguru\\site\\index.md') !== 2) {
      throw new Error('a file in a nested vault went to the vault around it');
    }
    // Above the inner one, still inside the outer.
    if (owner('C:\\Vaults\\Meadow\\notes.md') !== 1) throw new Error('a file above the nested vault lost its own');
    // A prefix is not a parent.
    if (owner('C:\\Vaults\\Meadow-old\\stale.md') !== null) throw new Error('a lookalike sibling folder was claimed');
    // Nothing owns a file outside every vault: that is the whole library.
    if (owner('C:\\Vaults\\loose.md') !== null) throw new Error('a file outside every vault was claimed');
    // And the same file under either spelling is the same file, off a Mac.
    if (owner('c:/vaults/meadow/notes.md') !== 1) throw new Error('another spelling of the same folder missed');
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
    if (groups.join('|') !== 'Work|Meadow|Outside a vault') {
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

  // The list reads the cloud answer the page already holds rather than asking again on every open; only a native window coming back after that answer is what still asks, because that is the one moment a client could have been installed.
  check('the vault list stops asking once it has an answer, and only a native focus after that answer asks again', () => {
    const sent = [];
    const context = runShell(source, { ipc: { postMessage: (raw) => sent.push(JSON.parse(raw)) } });
    const focus = () => {
      for (const handler of [...(context.__windowListeners.get('focus') || [])]) handler({});
    };
    const button = fakeElement('libraryVaultSwitch');
    button.classList.add('library-vault-switch');
    context.bindVaultSwitch(button, false);
    const press = button.listeners.get('pointerdown')[0];
    const event = { button: 0, stopPropagation() {}, preventDefault() {} };
    context.leafSetVaults({ vaults: VAULTS, active: 1 });

    focus();
    if (sent.some((one) => one.command === 'getCloudFolders')) {
      throw new Error(`a focus before startup's first answer asked anyway: ${JSON.stringify(sent)}`);
    }

    context.window.leafSetCloudFolders([]);
    sent.length = 0;
    press(event);
    if (sent.some((one) => one.command === 'getCloudFolders')) {
      throw new Error(`opening the list after the answer asked again: ${JSON.stringify(sent)}`);
    }
    press(event);
    press(event);
    if (sent.some((one) => one.command === 'getCloudFolders')) {
      throw new Error(`closing and reopening the list asked again: ${JSON.stringify(sent)}`);
    }

    focus();
    if (sent.filter((one) => one.command === 'getCloudFolders').length !== 1) {
      throw new Error(`a native focus after the answer did not ask exactly once: ${JSON.stringify(sent)}`);
    }

    sent.length = 0;
    context.window.__leafHostAnswers = () => true;
    focus();
    if (sent.some((one) => one.command === 'getCloudFolders')) {
      throw new Error(`a browser focus asked for cloud folders: ${JSON.stringify(sent)}`);
    }
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

  // Ids nothing else in the suite uses: the panel's state is a map keyed on the vault, and a row left behind here would change what a later check draws.
  const GIT_VAULT = { id: 91, name: 'Work', gitAutoSync: true };
  const PLAIN_VAULT = { id: 92, name: 'Plain', gitAutoSync: false };
  const SECOND_GIT_VAULT = { id: 93, name: 'Notes', gitAutoSync: true };
  const gitState = (vault, repo) => ({
    id: vault.id,
    suggested: vault.name.toLowerCase(),
    tooling: { git: true, gh: false, credentialHelper: true, identity: true },
    repo: Object.assign({ atRoot: true, remote: 'me/work', changed: 0, tracking: true }, repo),
    busy: false,
    message: null,
    error: false,
  });
  const panelItems = (vault) =>
    vm.runInContext(`vaultGitItems(${JSON.stringify(vault)})`, booted);
  const panelNotes = (vault) => panelItems(vault).filter((one) => one && one.note).map((one) => one.note);
  const ignoreButton = (vault) => panelItems(vault).find((one) => one && one.label === 'Ignore them');

  check('automatic sync is a switch only on a GitHub-ready vault and sends the opposite choice', () => {
    const sent = [];
    const watching = booted.window.ipc;
    booted.window.ipc = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
    try {
      booted.leafSetVaultGit(gitState(GIT_VAULT, {}));
      const owner = fakeElement('vaultGitOwner');
      booted.__testVault = GIT_VAULT;
      booted.__testVaultOwner = owner;
      vm.runInContext('showCrumbMenu(__testVaultOwner, vaultGitItems(__testVault))', booted);
      const menu = vm.runInContext('crumbMenu', booted);
      const row = menu.querySelectorAll('.crumb-menu-item').find((item) => item.getAttribute('role') === 'switch');
      if (!row) throw new Error('the GitHub-ready vault drew no automatic-sync switch');
      if (row.getAttribute('aria-checked') !== 'true') throw new Error('the switch did not expose the saved on state');
      const press = row.listeners.get('pointerdown')[0];
      press({ button: 0, stopPropagation() {}, preventDefault() {} });
      const asked = sent.find((one) => one.command === 'setVaultGitAutoSync');
      if (!asked || asked.id !== GIT_VAULT.id || asked.enabled !== false) {
        throw new Error(`the switch did not send the opposite choice for its vault: ${JSON.stringify(sent)}`);
      }
      if (menu.hidden) throw new Error('the switch closed the panel it belongs to');

      booted.leafSetVaultGit(gitState(PLAIN_VAULT, { remote: null }));
      if (panelItems(PLAIN_VAULT).some((one) => one && one.switch)) {
        throw new Error('a vault with nowhere to push drew an automatic-sync switch');
      }
      booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, {}), { busy: true }));
      const busySwitch = panelItems(GIT_VAULT).find((one) => one && one.switch);
      if (!busySwitch || !busySwitch.disabled) throw new Error('the switch stayed enabled while GitHub was busy');
    } finally {
      delete booted.__testVault;
      delete booted.__testVaultOwner;
      vm.runInContext('hideCrumbMenu()', booted);
      booted.window.ipc = watching;
    }
  });

  check('automatic sync starts, stops after failure, and manual success starts it again', () => {
    const sent = [];
    const watching = booted.window.ipc;
    booted.window.ipc = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
    try {
      booted.__testVaults = [GIT_VAULT, PLAIN_VAULT];
      vm.runInContext('leafVaults = __testVaults; activeVaultId = 91; syncInFlight = false;', booted);
      booted.leafSetVaultGit(gitState(GIT_VAULT, { changed: 1 }));

      booted.leafSetVaultStatus(GIT_VAULT.id, { atRoot: true, remote: 'me/work', changed: 1, ahead: 0 });
      booted.leafSetVaultStatus(GIT_VAULT.id, { atRoot: true, remote: 'me/work', changed: 1, ahead: 0 });
      if (sent.filter((one) => one.command === 'syncVault').length !== 1) {
        throw new Error(`two identical status answers started more than one sync, so syncInFlight did not stop the second: ${JSON.stringify(sent)}`);
      }

      booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, { changed: 1 }), { message: 'network failed', error: true }));
      if (!GIT_VAULT.gitAutoSync) throw new Error('a failure turned the vault choice off');
      booted.leafSetVaultStatus(GIT_VAULT.id, { atRoot: true, remote: 'me/work', changed: 1, ahead: 0 });
      if (sent.filter((one) => one.command === 'syncVault').length !== 1) {
        throw new Error('a later save tried automatic sync again after the last job failed');
      }

      const manual = panelItems(GIT_VAULT).find((one) => one && one.label === 'Sync');
      if (!manual) throw new Error('a stopped vault left no manual Sync press');
      manual.run();
      booted.leafVaultGitBusy(GIT_VAULT.id);
      booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, { changed: 0 }), { message: 'synced:1' }));
      booted.leafSetVaultStatus(GIT_VAULT.id, { atRoot: true, remote: 'me/work', changed: 1, ahead: 0 });
      if (sent.filter((one) => one.command === 'syncVault').length !== 3) {
        throw new Error(`manual Sync and its success did not start automatic sync again: ${JSON.stringify(sent)}`);
      }

      booted.leafSetVaultGit(gitState(GIT_VAULT, { changed: 1 }));
      booted.__testVaults = [Object.assign({}, GIT_VAULT, { gitAutoSync: false }), PLAIN_VAULT];
      vm.runInContext('leafVaults = __testVaults; syncSpinUntil = 0; if (syncSpinTimer) clearTimeout(syncSpinTimer); syncSpinTimer = 0;', booted);
      booted.leafSetVaultStatus(GIT_VAULT.id, { atRoot: true, remote: 'me/work', changed: 1, ahead: 0 });
      if (sent.filter((one) => one.command === 'syncVault').length !== 3) {
        throw new Error('automatic sync started while the vault choice was off');
      }
      const button = booted.document.getElementById('librarySyncButton');
      if (button.hidden || button.title !== 'Sync 1 to GitHub') {
        throw new Error('Off stopped the existing header button from waiting for a press');
      }
    } finally {
      delete booted.__testVaults;
      vm.runInContext('leafVaults = []; activeVaultId = 0; syncInFlight = false;', booted);
      booted.window.ipc = watching;
    }
  });

  check('one vault stopping automatic sync does not stop another vault', () => {
    const sent = [];
    const watching = booted.window.ipc;
    booted.window.ipc = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
    try {
      booted.__testVaults = [GIT_VAULT, SECOND_GIT_VAULT];
      vm.runInContext('leafVaults = __testVaults; activeVaultId = 91; syncInFlight = false;', booted);
      booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, { changed: 1 }), { message: 'network failed', error: true }));
      booted.leafSetVaultStatus(GIT_VAULT.id, { atRoot: true, remote: 'me/work', changed: 1, ahead: 0 });
      vm.runInContext('activeVaultId = 93;', booted);
      booted.leafSetVaultGit(gitState(SECOND_GIT_VAULT, { changed: 1 }));
      booted.leafSetVaultStatus(SECOND_GIT_VAULT.id, { atRoot: true, remote: 'me/notes', changed: 1, ahead: 0 });
      const starts = sent.filter((one) => one.command === 'syncVault');
      if (starts.length !== 1 || starts[0].id !== SECOND_GIT_VAULT.id) {
        throw new Error(`one vault's failure stopped another vault: ${JSON.stringify(sent)}`);
      }
    } finally {
      delete booted.__testVaults;
      vm.runInContext('leafVaults = []; activeVaultId = 0; syncInFlight = false;', booted);
      booted.window.ipc = watching;
    }
  });

  check('the stopped note follows the failed outcome only while automatic sync is stopped', () => {
    const stopped = 'Automatic sync stopped. Press Sync to start it again.';
    booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, { changed: 1 }), { message: 'network failed', error: true }));
    const items = panelItems(GIT_VAULT);
    const outcomeIndex = items.findIndex((one) => one && one.note === 'network failed');
    const stoppedIndex = items.findIndex((one) => one && one.note === stopped);
    if (outcomeIndex < 0 || stoppedIndex !== outcomeIndex + 1) {
      throw new Error(`the stopped note did not follow the failed outcome: ${JSON.stringify(items)}`);
    }
    if (items[stoppedIndex].danger) throw new Error('the stopped note repeated the failed outcome’s danger state');

    const switchedOff = Object.assign({}, GIT_VAULT, { gitAutoSync: false });
    if (panelNotes(switchedOff).includes(stopped)) throw new Error('the note remained after automatic sync was switched off');

    booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, {}), { message: 'synced:1' }));
    if (panelNotes(GIT_VAULT).includes(stopped)) throw new Error('the note remained after a successful sync');

    booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, {}), { busy: true, message: 'network failed', error: true }));
    if (panelNotes(GIT_VAULT).includes(stopped)) throw new Error('the note appeared while a new job was running');
    booted.leafSetVaultGit(gitState(GIT_VAULT, {}));
  });

  check('an automatic-sync failure keeps the stopped note out of the growl', () => {
    const said = [];
    const watching = booted.leafToast;
    booted.leafToast = (message) => said.push(message);
    try {
      booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, { changed: 1 }), { message: 'network failed', error: true }));
      if (said.length !== 1 || said[0] !== 'network failed') {
        throw new Error(`the failure growl repeated the stopped note: ${JSON.stringify(said)}`);
      }
    } finally {
      booted.leafToast = watching;
      booted.leafSetVaultGit(gitState(GIT_VAULT, {}));
    }
  });

  check('a vault that is its own repository is told which repositories it holds', () => {
    booted.leafSetVaultGit(gitState(GIT_VAULT, { nested: ['godaddy', 'notes/emptyguru'] }));
    const named = panelNotes(GIT_VAULT).find((note) => note.includes('godaddy'));
    if (!named) {
      throw new Error(`the panel said nothing about the repositories inside the vault: ${JSON.stringify(panelNotes(GIT_VAULT))}`);
    }
    if (!named.includes('notes/emptyguru')) throw new Error(`the note named one and dropped the other: ${named}`);

    // A vault holding none draws no row at all, or every vault carries a line saying nothing.
    booted.leafSetVaultGit(gitState(PLAIN_VAULT, { nested: [] }));
    if (panelNotes(PLAIN_VAULT).some((note) => note.includes('Repositories inside this vault'))) {
      throw new Error(`a vault holding no repositories drew the row anyway: ${JSON.stringify(panelNotes(PLAIN_VAULT))}`);
    }
  });

  check('a save landing while the panel is open does not blank what the folder holds', () => {
    booted.leafSetVaultGit(gitState(GIT_VAULT, { nested: ['godaddy'] }));
    // The per-save read walks no folder, so its payload carries no `nested` — and it replaces the panel's whole repo.
    booted.leafSetVaultStatus(GIT_VAULT.id, { atRoot: true, nested: [], remote: 'me/work', changed: 5, tracking: true });
    const notes = panelNotes(GIT_VAULT);
    if (!notes.some((note) => note.includes('godaddy'))) {
      throw new Error(`a status update blanked the note the panel had just drawn: ${JSON.stringify(notes)}`);
    }
    // What the cheap read does answer still lands.
    if (!notes.some((note) => note.includes('5 changed'))) {
      throw new Error(`the status update's own count did not reach the panel: ${JSON.stringify(notes)}`);
    }
  });

  check('only the repositories nothing is holding back are offered, and one press ignores them', () => {
    const sent = [];
    const watching = booted.window.ipc;
    booted.window.ipc = { postMessage: (raw) => sent.push(JSON.parse(raw)) };
    try {
      booted.leafSetVaultGit(
        gitState(GIT_VAULT, {
          nested: ['godaddy', 'notes/emptyguru', 'leaftext/app'],
          tracked: ['godaddy'],
          unhandled: ['leaftext/app'],
        }),
      );
      const warning = panelNotes(GIT_VAULT).find((note) => note.includes('swallow'));
      if (!warning) throw new Error(`nothing warned about the repository the sync would swallow: ${JSON.stringify(panelNotes(GIT_VAULT))}`);
      if (!warning.includes('leaftext/app')) throw new Error(`the warning does not name it: ${warning}`);
      // The one the vault already tracks is named above and kept out of the offer: an ignore line for it does nothing.
      if (warning.includes('godaddy')) throw new Error(`a repository the vault already tracks was offered up: ${warning}`);

      const button = ignoreButton(GIT_VAULT);
      if (!button) throw new Error('the warning came with no way to act on it');
      button.run();
      const asked = sent.find((one) => one.command === 'ignoreVaultRepos');
      if (!asked) throw new Error(`the press sent nothing: ${JSON.stringify(sent)}`);
      if (asked.id !== GIT_VAULT.id) throw new Error(`the press named the wrong vault: ${JSON.stringify(asked)}`);
      // The host decided which, so the page sends back exactly what it was handed.
      if (JSON.stringify(asked.paths) !== JSON.stringify(['leaftext/app'])) {
        throw new Error(`the press asked for the wrong paths: ${JSON.stringify(asked)}`);
      }

      // The owner's own vault: everything found is already tracked or already ignored, so the note stands alone.
      booted.leafSetVaultGit(
        gitState(PLAIN_VAULT, { nested: ['godaddy'], tracked: ['godaddy'], unhandled: [] }),
      );
      if (ignoreButton(PLAIN_VAULT)) throw new Error('a vault with nothing to ignore was offered the button anyway');
      if (panelNotes(PLAIN_VAULT).some((note) => note.includes('swallow'))) {
        throw new Error('a vault with nothing to ignore was warned anyway');
      }
    } finally {
      booted.window.ipc = watching;
    }
  });

  check('an ignore that landed says so in the reader’s own words', () => {
    // The host answers with a tag; a tag on screen is the panel saying "ignored" at somebody reading it.
    const settled = { nested: ['leaftext/app'], tracked: ['leaftext/app'], unhandled: [] };
    booted.leafSetVaultGit(Object.assign(gitState(GIT_VAULT, settled), { message: 'ignored' }));
    const notes = panelNotes(GIT_VAULT);
    if (notes.some((note) => note === 'ignored')) {
      throw new Error('the panel put the host’s tag on screen rather than a sentence');
    }
    if (!notes.some((note) => note.includes('.gitignore'))) {
      throw new Error(`nothing said where the lines went: ${JSON.stringify(notes)}`);
    }
  });

  check('the home vault switcher keeps the regular marks and leaves room before its name', () => {
    const css = readingCss();
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
