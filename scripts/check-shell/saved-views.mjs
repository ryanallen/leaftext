// A named filter saved off the search box, and the list it draws when it is opened.

import {
  check,
  record,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 5d. a filter somebody saved -------------------------------------------
  //
  // The one search box is where a view is made, so the control that saves one has to be absent in every state where there is nothing to save — no vault to hold it, or no query to keep. Everything after that is the page and the host agreeing on an identity: a view is opened, deleted and drawn by the id the host sent, and a page that read the wrong one opens somebody else's list.

  const savedViews = booted.document.getElementById('savedViews');
  const saveButton = booted.document.getElementById('saveViewButton');
  const searchField = booted.document.getElementById('librarySearch');
  const libraryTree = booted.document.getElementById('libraryTree');

  const VAULT = { id: 7, name: 'Notes', rootPath: 'C:\\Notes' };
  const VIEWS = [
    { id: 11, vaultId: 7, position: 0, name: 'Open', query: 'status:open', shape: 'list', shapeSettings: '{"version":1}' },
    { id: 12, vaultId: 7, position: 1, name: 'Waiting', query: 'status:waiting', shape: 'list', shapeSettings: '{"version":1}' },
  ];

  const fire = (element, event, detail = {}) => {
    for (const handler of element.listeners.get(event) || []) handler(detail);
  };
  /** The field typed into, the way a reader types into it. */
  const type = (text) => {
    searchField.value = text;
    fire(searchField, 'input');
  };

  const sent = [];
  const wasSend = booted.ipc.postMessage;
  /** Everything the page sent while `body` ran. */
  const sending = (body) => {
    sent.length = 0;
    body();
    return sent.map((one) => JSON.parse(JSON.stringify(one)));
  };

  const withVault = () => {
    booted.leafSetVaults({ vaults: [VAULT], active: VAULT.id });
    booted.leafSetSavedViews(VIEWS);
  };
  const reset = () => {
    booted.ipc.postMessage = wasSend;
    type('');
    booted.leafSetSavedViews([]);
    booted.leafSetVaults({ vaults: [], active: 0 });
  };

  check('the save control appears only where there is a vault to hold a view and a query to keep', () => {
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));

      booted.leafSetVaults({ vaults: [], active: 0 });
      type('draft');
      if (!saveButton.hidden) throw new Error('a reader with no vault was offered somewhere to save a filter');
      if (!savedViews.hidden) throw new Error('the Views list drew itself with no vault to hold one');

      withVault();
      type('');
      if (!saveButton.hidden) throw new Error('an empty search box offered to save nothing');

      type('draft');
      if (saveButton.hidden) throw new Error('a typed filter in a vault was offered nowhere to save it');
      if (savedViews.hidden) throw new Error('the Views list is hidden inside the vault that holds them');

      // A query of nothing but spaces is an empty query.
      type('   ');
      if (!saveButton.hidden) throw new Error('a query of spaces was offered a name');
    } finally {
      reset();
    }
  });

  check('naming a view starts from the query, saves on Enter and cancels on Escape', () => {
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      withVault();
      type('status:open');

      const opening = sending(() => fire(saveButton, 'click'));
      if (opening.length) throw new Error(`opening the name row sent ${JSON.stringify(opening)} before anything was named`);
      const naming = savedViews.querySelector('.saved-view-name');
      if (!naming) throw new Error('pressing save drew no name row');
      // The query is the name until somebody says otherwise, so a reader who just presses Enter gets a view named after what they typed.
      if (naming.value !== 'status:open') throw new Error(`the name row started at ${JSON.stringify(naming.value)} rather than the query`);

      naming.value = 'Open work';
      const saved = sending(() => fire(naming, 'keydown', { key: 'Enter' }));
      const save = saved.find((one) => one.command === 'saveView');
      if (!save) throw new Error(`Enter sent ${JSON.stringify(saved.map((one) => one.command))}`);
      if (save.name !== 'Open work' || save.query !== 'status:open') {
        throw new Error(`the view saved was ${JSON.stringify(save)}`);
      }
      // The row closes on the host's answer, the same way a deleted view leaves the list on one: the page never draws a view it has not been given.
      booted.leafSetSavedViews([...VIEWS, { id: 13, vaultId: 7, position: 2, name: 'Open work', query: 'status:open', shape: 'list', shapeSettings: '{"version":1}' }]);
      if (savedViews.querySelector('.saved-view-name')) throw new Error('the name row outlived the save');

      // Escape leaves nothing behind: no view, and the box back the way it was.
      fire(saveButton, 'click');
      const escaping = savedViews.querySelector('.saved-view-name');
      if (!escaping) throw new Error('the name row did not come back for a second view');
      const canceled = sending(() => fire(escaping, 'keydown', { key: 'Escape' }));
      if (canceled.length) throw new Error(`Escape sent ${JSON.stringify(canceled)}`);
      if (savedViews.querySelector('.saved-view-name')) throw new Error('Escape left the name row standing');

      // A name of nothing is not a view, so Enter over an empty row keeps the row.
      fire(saveButton, 'click');
      const empty = savedViews.querySelector('.saved-view-name');
      empty.value = '   ';
      const blank = sending(() => fire(empty, 'keydown', { key: 'Enter' }));
      if (blank.some((one) => one.command === 'saveView')) throw new Error('a view was saved under no name');
    } finally {
      reset();
    }
  });

  check('a saved view is opened and deleted by the id the host gave it', () => {
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      withVault();

      const rows = savedViews.querySelectorAll('.saved-view-open');
      if (rows.length !== VIEWS.length) throw new Error(`the list drew ${rows.length} of ${VIEWS.length} views`);
      if (rows.map((row) => row.textContent || row.innerHTML).join('|') !== 'Open|Waiting') {
        throw new Error(`the list drew ${rows.map((row) => row.innerHTML).join('|')} in that order`);
      }

      // The second one, so a page reading the wrong row would open the first and pass.
      const opened = sending(() => fire(rows[1], 'click'));
      if (opened.length !== 1 || opened[0].command !== 'runView' || opened[0].id !== 12) {
        throw new Error(`opening the second view sent ${JSON.stringify(opened)}`);
      }

      const crosses = savedViews.querySelectorAll('.saved-view-delete');
      const deleted = sending(() => fire(crosses[1], 'click'));
      if (deleted.length !== 1 || deleted[0].command !== 'deleteView' || deleted[0].id !== 12) {
        throw new Error(`deleting the second view sent ${JSON.stringify(deleted)}`);
      }

      // The list is the host's answer, never the page's guess: nothing goes until the host says it has.
      if (savedViews.querySelectorAll('.saved-view-open').length !== VIEWS.length) {
        throw new Error('the page took a view off the list before the host answered');
      }
      booted.leafSetSavedViews([VIEWS[0]]);
      if (savedViews.querySelectorAll('.saved-view-open').length !== 1) throw new Error('the host answer did not redraw the list');
    } finally {
      reset();
    }
  });

  check('a view opens one row per document and says when its list was cut', () => {
    try {
      booted.ipc.postMessage = (text) => sent.push(JSON.parse(text));
      withVault();
      type('status:open');

      booted.leafSetSavedViewResults({
        rows: [
          { absPath: 'C:\\Notes\\one.md', title: 'one' },
          { absPath: 'C:\\Notes\\two.md', title: 'two' },
        ],
        truncated: false,
      });
      const drawn = libraryTree.querySelectorAll('[data-open-path]');
      if (drawn.length !== 2) throw new Error(`the view drew ${drawn.length} rows for two documents`);
      // The search box is the view's own: opening a view empties it, or the pane shows a filter that is not what it is listing.
      if (searchField.value !== '') throw new Error(`opening a view left ${JSON.stringify(searchField.value)} in the search box`);

      const opened = sending(() => fire(drawn[1], 'pointerdown', { button: 0, pointerType: 'mouse', preventDefault() {}, stopPropagation() {} }));
      const open = opened.find((one) => one.command === 'open');
      if (!open || open.path !== 'C:\\Notes\\two.md') throw new Error(`pressing the second row sent ${JSON.stringify(opened)}`);

      // A cut list has to say so, or a reader takes a thousand documents for all of them.
      booted.leafSetSavedViewResults({ rows: [{ absPath: 'C:\\Notes\\one.md', title: 'one' }], truncated: true });
      if (!libraryTree.innerHTML.includes('1,000')) {
        throw new Error(`a cut list said nothing: ${libraryTree.innerHTML.slice(0, 300)}`);
      }
      booted.leafSetSavedViewResults({ rows: [{ absPath: 'C:\\Notes\\one.md', title: 'one' }], truncated: false });
      if (libraryTree.innerHTML.includes('1,000')) throw new Error('a whole list claimed it had been cut');
    } finally {
      reset();
    }
  });
}
