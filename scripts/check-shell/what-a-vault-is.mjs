// What the pane says a vault is, said once.

import vm from 'node:vm';
import {
  check,
  record,
  runShell,
  siteBoot,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 5c. the pane says what a vault is, once --------------------------------
  //
  // A box at the top of the file list, for a reader who has never made a vault. Four flags decide it and every one of them can be wrong in a way nothing else would catch: the store keeps no record of who made a vault, so "never made one" is answered by whether every vault sits inside a sync client's folder — and that answer arrives after boot, which is why an unanswered list must draw nothing rather than guess.

  const libraryTreeElement = booted.document.getElementById('libraryTree');
  const CLOUD_FOLDERS = [{ path: 'C:\\Users\\me\\Dropbox' }];
  // Registered by the app itself because a sync client put the folder there — see remote-sources. Nobody chose it, so it is not evidence the reader knows what a vault is.
  const CLOUD_VAULT = { id: 1, name: 'Dropbox', rootPath: 'C:\\Users\\me\\Dropbox\\Notes' };
  const OWN_VAULT = { id: 2, name: 'Notes', rootPath: 'C:\\Vaults\\Notes' };

  /** The pane drawn against one arrangement of the four flags. `folders` of null is the answer that has not landed yet. */
  function paneWith({ met = true, folders = CLOUD_FOLDERS, vaults = [] } = {}) {
    booted.leafResetHints();
    if (met) booted.retireHint('libraryVault');
    vm.runInContext('cloudFolders = null;', booted);
    booted.leafSetVaults({ vaults, active: 0 });
    if (folders) booted.leafSetCloudFolders(folders);
    booted.renderLibrary();
    return libraryTreeElement.innerHTML;
  }
  const introducing = (arrangement) => paneWith(arrangement).includes('library-intro');

  check('the pane introduces vaults to the reader who never made one, and to nobody else', () => {
    try {
      if (!introducing({})) throw new Error('a reader with no vault at all was told nothing');
      if (!introducing({ vaults: [CLOUD_VAULT] })) {
        throw new Error('a vault that registered itself out of a sync folder counted as one the reader made');
      }
      if (introducing({ vaults: [OWN_VAULT] })) throw new Error('a reader who already made a vault was introduced to them');
      if (introducing({ vaults: [CLOUD_VAULT, OWN_VAULT] })) {
        throw new Error('one folder the reader chose was lost behind an auto-registered one');
      }
      // The answer has not arrived: every vault looks unchosen, and drawing on that is a guess.
      if (introducing({ folders: null, vaults: [OWN_VAULT] })) {
        throw new Error('the pane guessed before the cloud folders came back');
      }
      if (introducing({ folders: null })) throw new Error('the pane drew the box before it could know');
      // One thing at a time: the bubble pointing at the vault button has to have been met first.
      if (introducing({ met: false })) throw new Error('the box was drawn beside a bubble the reader had not met yet');
      // And it is the words the ticket settled, with the same button the start screen offers.
      const drawn = paneWith({});
      for (const wanted of ['A vault is one folder of notes.', 'library-intro-text', '>Add your notes folder<']) {
        if (!drawn.includes(wanted)) throw new Error(`the introduction is missing ${wanted}: ${drawn.slice(0, 400)}`);
      }
      // First in the list, above whatever the pane is browsing — which, with no vault, is the machine's drives.
      const rows = drawn.indexOf('library-project');
      if (rows >= 0 && drawn.indexOf('library-intro') > rows) throw new Error('the introduction landed under the list rather than above it');
    } finally {
      booted.leafResetHints();
      booted.leafSetVaults({ vaults: [], active: 0 });
      vm.runInContext('cloudFolders = null;', booted);
      booted.renderLibrary();
    }
  });

  check('the introduction is retired for good by picking a folder or by opening the list that offers one', () => {
    const sent = [];
    const wasSend = booted.ipc.postMessage;
    // The button the page drew, taken off the pane the way the page takes it.
    const introAction = () => libraryTreeElement.querySelector('.library-intro-action');
    const metNames = () => {
      const saves = sent.filter((one) => one.command === 'setHintState');
      return saves.length ? saves[saves.length - 1].seen : [];
    };
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));

      // Its own button: the command the pane's menu already sends, and the box gone for good.
      paneWith({});
      const introButton = introAction();
      if (!introButton) throw new Error('the box drew no button to press');
      sent.length = 0;
      for (const handler of introButton.listeners.get('click') || []) handler({});
      if (!sent.some((one) => one.command === 'createVault')) {
        throw new Error(`pressing it sent ${JSON.stringify(sent.map((one) => one.command))}`);
      }
      if (!metNames().includes('vaultIntro')) throw new Error(`the name was never saved: ${JSON.stringify(metNames())}`);
      if (libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box outlived the press');
      // And it does not come back on the next read of the same folder.
      booted.renderLibrary();
      if (libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box came back on the next read');

      // Opening the vault list is meeting New vault…, so the box has said its piece either way.
      paneWith({});
      if (!libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box did not come back for a fresh reader');
      sent.length = 0;
      const switcher = booted.document.getElementById('libraryVaultSwitch');
      for (const handler of switcher.listeners.get('pointerdown') || []) {
        handler({ button: 0, stopPropagation() {}, preventDefault() {} });
      }
      if (!metNames().includes('vaultIntro')) throw new Error(`opening the list saved ${JSON.stringify(metNames())}`);
      if (libraryTreeElement.innerHTML.includes('library-intro')) throw new Error('the box outlived the menu opening');
    } finally {
      booted.ipc.postMessage = wasSend;
      booted.hideCrumbMenu();
      booted.leafResetHints();
      booted.leafSetVaults({ vaults: [], active: 0 });
      vm.runInContext('cloudFolders = null;', booted);
      booted.renderLibrary();
    }
  });

  // A site cannot pick a folder on a disk it is not on, and an embed draws no pane at all — so neither may draw a box whose one button its host refuses.
  check('neither browser host introduces a vault it could not make', () => {
    const hosts = [
      ['a published site', siteBoot(true).context],
      ['an embed', runShell(source, { __leafEmbedded: true })],
    ];
    for (const [name, context] of hosts) {
      // Every flag set the way the window's would be, so what is being read is the browser guard and not an accident of the hints being off.
      context.retireHint('libraryVault');
      context.leafSetCloudFolders([{ path: 'C:\\Users\\me\\Dropbox' }]);
      context.renderLibrary();
      const drawn = context.document.getElementById('libraryTree').innerHTML;
      if (drawn.includes('library-intro')) throw new Error(`${name} introduced a vault its host refuses to make: ${drawn.slice(0, 300)}`);
      if (drawn.includes('Add your notes folder')) throw new Error(`${name} drew the button on its own`);
    }
  });
}
