// The embed's own host: what it answers for a document inside somebody else's product.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  checkSettled,
  noopPost,
  record,
  root,
  runShell,
  settle,
  source,
  standInState,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- the embed's own host ---------------------------------------------------
  //
  // `web/embed/host.js` is the third half of the same bargain: the app's own front end in a frame somebody else's product owns, over a document buffer in the module, with the save handed back to whoever mounted it.
  //
  // It is handed a loaded module rather than loading one, so the stand-in here is a plain object rather than a linear memory — what is under test is the host's dispatch and the page calls that follow it. The arithmetic under each of those edits is held to the desktop's own bytes in `web/buffer.json`, walked by a test beside the fixtures and by `scripts/build-web.mjs` against the built module, so nothing about it needs proving twice.

  const EMBED_SOURCE = '# Notes\n\n- [ ] one task\n\nThe last paragraph.\n';

  /** A stand-in for the browser module's buffer. It applies the edits whose *text* a check below reads back, records every edit it is handed for the checks that read the dispatch, and reports any known edit as one that moved the buffer so the redraw path runs either way. */
  function standInEmbedModule({ source = EMBED_SOURCE, path = 'notes.md', mark = false } = {}) {
    const asked = [];
    const KNOWN = new Set(['splice', 'block', 'text', 'task', 'field', 'move', 'undo']);
    let text = source;
    let saved = source;
    let open = false;
    // Every undoable edit's buffer, newest last — the same shape the library's own stack has.
    const history = [];

    const state = () => ({
      path,
      dirty: text !== saved,
      canUndo: history.length > 0,
      tasks: [],
      utf16Len: text.length,
      spelling: { encoding: 'utf8', mark },
    });

    /** The edits whose text a check reads back. This document is ASCII, so a block's byte range and a JavaScript string index are the same number; the real module is held to a fixture with an emoji in it for exactly the case where they are not. */
    const apply = (edit) => {
      switch (edit.edit) {
        case 'block':
          history.push(text);
          text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
          return;
        case 'splice':
          text = text.slice(0, edit.start) + edit.inserted + text.slice(edit.start + edit.removed);
          return;
        case 'text':
          text = edit.text;
          return;
        case 'task':
          text = text.replace('- [ ]', '- [x]');
          return;
        case 'undo':
          if (history.length) text = history.pop();
          return;
        default:
          return;
      }
    };

    return {
      asked,
      text: () => text,
      setGlossary: (glossary) => asked.push({ call: 'setGlossary', glossary }),
      glossaryScript: (href) => {
        asked.push({ call: 'glossaryScript', href });
        return `window.__leafGlossary = ${JSON.stringify({ href })};`;
      },
      buffer: {
        open: (given, name) => {
          asked.push({ call: 'open', path: name });
          open = true;
          return 1;
        },
        close: () => {
          open = false;
        },
        source: () => (open ? text : null),
        encoded: () => (open ? new TextEncoder().encode((mark ? '﻿' : '') + text) : null),
        state: () => (open ? state() : null),
        render: () => ({ title: 'Notes', path, html: `<p>${text}</p>`, blocks: [], tasks: [] }),
        edit: (handle, edit) => {
          asked.push({ call: 'edit', edit });
          const before = text;
          apply(edit);
          return { ...state(), changed: text !== before || KNOWN.has(edit.edit) };
        },
        // The two lines the real module builds in Rust, in the shape the page reads them.
        documentScript: () =>
          `window.leafSetState(${JSON.stringify(standInState(path))});\nwindow.leafBlocksResynced(${JSON.stringify({ tasks: [], dirty: text !== saved, canUndo: history.length > 0, source: null })});`,
        saveScript: (handle, ok, error) => {
          if (ok) {
            saved = text;
            history.length = 0;
          }
          // The reply and the editing state, both, exactly as the real module answers: a page told the save came back and left with a lit Save button is a page that reads as unsaved.
          return `window.leafSaved(${JSON.stringify(path)}, ${!!ok}, ${error ? JSON.stringify(error) : 'null'});\nwindow.leafBlocksResynced(${JSON.stringify({ tasks: [], dirty: text !== saved, canUndo: history.length > 0, source: null })});`;
        },
      },
    };
  }

  /** The embed host, in a page that has what a mounted frame has. `save` is whatever the product does with the document; leaving it out is a reader that never persists. */
  async function bootEmbedHost({ save = null, glossary = '', pending = [], module = null, path = 'notes.md', mark = false } = {}) {
    const stand = module || standInEmbedModule({ path, mark });
    const context = runShell(source, { __leafEmbedded: true, __leafPending: [...pending] });
    context.window.ipc = { postMessage: noopPost };

    // Everything the host hands the page, recorded on the way through. The state call is recorded and not run, for the reason the site host's is: it renders a whole document, and nothing is rendered on this page for it to render into.
    const seen = { state: [], resynced: [], saved: [], pager: [] };
    const watch = (name, into) => {
      context.window[name] = (...payload) => into.push(payload.length > 1 ? payload : payload[0]);
    };
    watch('leafSetState', seen.state);
    watch('leafBlocksResynced', seen.resynced);
    watch('leafSaved', seen.saved);
    watch('leafSetPager', seen.pager);

    const host = readFileSync(join(root, 'web/embed/host.js'), 'utf8');
    // The host is an ES module with four exports and no imports, so it evaluates as a script once the export keyword is off. That it has no imports is the point — see the file's own note.
    new vm.Script(host.replace(/^export /gm, '') + '\nglobalThis.__startLeaftextEmbed = startLeaftextEmbed;\nglobalThis.__embedCOMMANDS = COMMANDS;\nglobalThis.__embedAnswers = answers;', {
      filename: 'embed-host.js',
    }).runInContext(context);

    const events = [];
    const leaf = context.__startLeaftextEmbed({
      module: stand,
      source: EMBED_SOURCE,
      path,
      glossary,
      save,
      onEvent: (event) => events.push(event),
    });
    return {
      context,
      leaf,
      stand,
      seen,
      events,
      asked: stand.asked,
      send: (message) => context.window.ipc.postMessage(JSON.stringify(message)),
    };
  }

  check('an embedded page draws the document and nothing around it', () => {
    const embedded = runShell(source, { __leafEmbedded: true });
    if (!embedded.document.body.classList.contains('is-embedded')) {
      throw new Error('an embedded page never marked its body, so the stylesheet has nothing to read');
    }
    // The stylesheet is what takes the bar, the pane, the handle and the floating toolbar down, so what it aims at has to exist.
    const css = readFileSync(join(root, 'src/assets/reading.css'), 'utf8');
    for (const wanted of ['body.is-embedded .app-bar', 'body.is-embedded .library-pane', 'body.is-embedded .library-divider', 'body.is-embedded .reader-toolbar', 'body.is-embedded .library-shell']) {
      if (!css.includes(wanted)) throw new Error(`the stylesheet no longer has a rule for ${wanted}, so an embed would draw it`);
    }
    // A window is not an embed, and the mark must not appear in one.
    if (booted.document.body.classList.contains('is-embedded')) throw new Error('the app in a window marked itself embedded');
  });

  checkSettled('the embed host hands the caller the whole document with its spelling, not the splice', async () => {
    const written = [];
    const { send, seen, stand } = await bootEmbedHost({ mark: true, save: async (document) => written.push(document) });

    // Typing into a block: the page sends the range it replaced, and what the caller is handed is the document.
    send({ command: 'editBlock', start: 21, end: 40, text: 'The last line.' });
    await settle();
    send({ command: 'saveDocument' });
    await settle();

    if (written.length !== 1) throw new Error(`the caller was handed ${written.length} saves for one Save`);
    const handed = written[0];
    if (handed.text !== stand.text()) throw new Error(`the caller was handed ${JSON.stringify(handed.text)} rather than the document`);
    if (!handed.text.includes('The last line.')) throw new Error('the caller was handed a document without the edit in it');
    if (!handed.text.includes('# Notes')) throw new Error('the caller was handed the splice rather than the whole document');
    // The spelling travels with it, so a product holding a file cannot re-spell somebody's document by saving it.
    if (handed.spelling.encoding !== 'utf8' || handed.spelling.mark !== true) throw new Error(`the spelling was lost: ${JSON.stringify(handed.spelling)}`);
    if (handed.bytes[0] !== 0xef || handed.bytes[1] !== 0xbb || handed.bytes[2] !== 0xbf) throw new Error('the bytes came back without the mark the document arrived with');

    // And the page is told, so the Save button goes out.
    const reply = seen.saved[seen.saved.length - 1];
    if (!reply || reply[1] !== true) throw new Error(`the page was told the save came back as ${JSON.stringify(reply)}`);
    const resynced = seen.resynced[seen.resynced.length - 1];
    if (!resynced || resynced.dirty !== false) throw new Error(`a saved document still reports dirty: ${JSON.stringify(resynced)}`);
  });

  checkSettled('a save the product refuses leaves the document as it was typed and says why', async () => {
    const { send, seen } = await bootEmbedHost({
      save: async () => {
        throw new Error('the server said no');
      },
    });
    send({ command: 'editBlock', start: 21, end: 40, text: 'The last line.' });
    await settle();
    send({ command: 'saveDocument' });
    await settle();

    const reply = seen.saved[seen.saved.length - 1];
    if (!reply) throw new Error('a refused save told the page nothing at all');
    if (reply[1] !== false) throw new Error(`a refused save was reported to the page as ${JSON.stringify(reply)}`);
    if (!String(reply[2]).includes('the server said no')) throw new Error(`the reason never reached the page: ${JSON.stringify(reply)}`);
    const resynced = seen.resynced[seen.resynced.length - 1];
    if (!resynced || resynced.dirty !== true) throw new Error('a refused save cleared the Save button, so the reader would think it was written');
  });

  /** Every editing command the page can send, and the edit the buffer has to be handed for it. The desktop's own arms are the other side of each of these. */
  const EMBED_EDITS = [
    [{ command: 'editBlock', start: 0, end: 7, text: '# Retitled' }, { edit: 'block', start: 0, end: 7, text: '# Retitled', undo: true }],
    [{ command: 'toggleTask', index: 0 }, { edit: 'task', index: 0 }],
    [{ command: 'setField', key: 'title', value: 'Notes' }, { edit: 'field', key: 'title', set: 'Notes' }],
    [{ command: 'setField', key: 'title' }, { edit: 'field', key: 'title', remove: true }],
    [{ command: 'setListField', key: 'tags', items: ['one'] }, { edit: 'field', key: 'tags', items: ['one'] }],
    [{ command: 'renameField', key: 'title', to: 'heading' }, { edit: 'field', key: 'title', rename: 'heading' }],
    [{ command: 'moveBlock', ranges: [[0, 7], [9, 20]], from: 1, to: 0 }, { edit: 'move', ranges: [[0, 7], [9, 20]], from: 1, to: 0 }],
    [{ command: 'undoEdit' }, { edit: 'undo' }],
    [{ command: 'redoEdit' }, { edit: 'redo' }],
    [{ command: 'updateSource', text: '# Whole\n' }, { edit: 'text', text: '# Whole\n' }],
  ];

  checkSettled('every editing command reaches the buffer as the edit the desktop makes for it', async () => {
    for (const [command, wanted] of EMBED_EDITS) {
      const { send, asked } = await bootEmbedHost({ save: async () => {} });
      send(command);
      await settle();
      const made = asked.filter((one) => one.call === 'edit').map((one) => one.edit);
      const found = made.find((edit) => edit.edit === wanted.edit);
      if (!found) throw new Error(`${command.command} reached the buffer as ${JSON.stringify(made)} rather than a ${wanted.edit} edit`);
      for (const [key, value] of Object.entries(wanted)) {
        if (JSON.stringify(found[key]) !== JSON.stringify(value)) {
          throw new Error(`${command.command} sent ${key} as ${JSON.stringify(found[key])} rather than ${JSON.stringify(value)}`);
        }
      }
    }
  });

  checkSettled('a pause in the typing moves an embedded buffer and leaves the document standing', async () => {
    const { send, asked, seen } = await bootEmbedHost({ save: async () => {} });
    // A redraw is the host handing the page a whole document again, which is the thing a live splice must not do.
    const drawn = () => seen.state.length;
    const before = drawn();
    // Still typing in the block: the box on screen is already the picture, so a redraw would take the words out from under the caret. And every splice of the run after its first records no undo point, or one sentence would take four presses to take back.
    send({ command: 'editBlock', start: 0, end: 7, text: '# Retitled', live: true, continuing: true });
    await settle();
    const made = asked.filter((one) => one.call === 'edit').map((one) => one.edit);
    const found = made.find((edit) => edit.edit === 'block');
    if (!found) throw new Error(`a live splice reached the buffer as ${JSON.stringify(made)}`);
    if (found.undo !== false) throw new Error('a splice continuing a typing run started a second undo step');
    if (drawn() !== before) throw new Error('a live splice redrew the document the reader was typing in');

    // The commit that ends the run is the one that redraws, and it is still the same buffer underneath.
    send({ command: 'editBlock', start: 0, end: 10, text: '# Retitled again', continuing: true });
    await settle();
    if (drawn() === before) throw new Error('the commit that ends a run never redrew the document');
  });

  checkSettled('an edit that writes itself reaches the caller without a Save press, and an undoable one does not', async () => {
    const writes = [];
    const { send } = await bootEmbedHost({ save: async () => writes.push('save') });
    // A checkbox writes itself on the desktop, and an embed draws no Save button for a reader to press instead.
    send({ command: 'toggleTask', index: 0 });
    await settle();
    if (writes.length !== 1) throw new Error(`a task toggle handed the caller ${writes.length} saves rather than one`);
    send({ command: 'editBlock', start: 0, end: 7, text: '# Retitled' });
    await settle();
    if (writes.length !== 1) throw new Error('an ordinary block edit wrote itself, so nothing would be left for Save to do');
  });

  checkSettled('a waiting state is a promise: an embed answers the strip rather than leaving it spinning', async () => {
    const { send, seen } = await bootEmbedHost();
    send({ command: 'loadPager', path: 'notes.md' });
    await settle();
    const strip = seen.pager[seen.pager.length - 1];
    if (!strip) throw new Error('the strip was never answered, so an embedded document keeps a skeleton for ever');
    if (strip.html !== '') throw new Error(`an embed has no neighbors and answered with ${JSON.stringify(strip.html)}`);
  });

  checkSettled('a link inside an embedded document goes to the product, and the glossary is raised out of the text it was handed', async () => {
    const { send, events, asked } = await bootEmbedHost({ glossary: '## Vault\n\nA folder you named.\n' });
    send({ command: 'openLink', href: 'other.md', scroll_anchor: { section: '', block: 0, offsetY: 0 } });
    await settle();
    const followed = events.find((event) => event.kind === 'link');
    if (!followed) throw new Error('a link a reader clicked reached nobody');
    if (followed.href !== 'other.md') throw new Error(`the link arrived as ${JSON.stringify(followed.href)}`);

    if (!asked.some((one) => one.call === 'setGlossary' && one.glossary.includes('A folder you named.'))) {
      throw new Error('the glossary text never crossed into the module');
    }
    send({ command: 'openGlossary', href: 'glossary:vault' });
    await settle();
    if (!asked.some((one) => one.call === 'glossaryScript' && one.href === 'glossary:vault')) {
      throw new Error('the glossary command never reached the module with its term');
    }
  });

  checkSettled('the embed host refuses what an embed has no business doing, with the reason off its own table', async () => {
    const { send, leaf, context } = await bootEmbedHost();
    for (const command of ['search', 'createVault', 'getFolder', 'closeTab', 'applyUpdate']) {
      send({ command });
    }
    await settle();
    if (leaf.refused.length !== 5) throw new Error(`five commands an embed cannot answer produced ${leaf.refused.length} refusals`);
    for (const one of leaf.refused) {
      if (!one.reason || one.reason === 'no line in the command table') {
        throw new Error(`${one.command} was refused with no reason: ${JSON.stringify(one)}`);
      }
      if (one.kind !== 'refused') throw new Error(`${one.command} came back as ${one.kind} rather than a refusal`);
    }
    // Every command the table says is answered has an arm, which is the one thing the parity gate cannot see.
    record.embedAnswered = Object.keys(context.__embedCOMMANDS).filter((name) => context.__embedAnswers(name)).length;
    const armless = Object.entries(context.__embedCOMMANDS)
      .filter(([name, [kind]]) => kind === 'answered' && !context.__embedAnswers(name))
      .map(([name]) => name);
    if (armless.length) throw new Error(`the table says these are answered: ${armless.join(', ')}`);
    const sent = [];
    for (const [name, [kind]] of Object.entries(context.__embedCOMMANDS)) {
      if (kind !== 'answered') continue;
      sent.push(name);
    }
    const before = leaf.refused.length;
    for (const name of sent) send({ command: name, index: 0, key: 'k', ranges: [], href: '', path: 'notes.md', text: '', start: 0, end: 0, removed: 0, inserted: '', length: 0, items: [], to: 'x', enabled: true, family: 'fern', mode: 'dark', used: [] });
    await settle();
    if (leaf.refused.length !== before) {
      throw new Error(`a command the table says is answered had no arm: ${leaf.refused.slice(before).map((one) => one.command).join(', ')}`);
    }
  });

  checkSettled('an embed with no save callback says so rather than reporting a document written', async () => {
    const { send, seen } = await bootEmbedHost();
    send({ command: 'editBlock', start: 21, end: 40, text: 'The last line.' });
    await settle();
    send({ command: 'saveDocument' });
    await settle();
    if (seen.saved.length) throw new Error(`a reader with nowhere to save told the page it saved: ${JSON.stringify(seen.saved)}`);
  });

  checkSettled('the front end sends its first commands before the host is standing, and the embed host drains them', async () => {
    const { seen } = await bootEmbedHost({ pending: [JSON.stringify({ command: 'loadPager', path: 'notes.md' })] });
    await settle();
    if (!seen.pager.length) throw new Error('a command sent while the host was loading was thrown away');
  });
}
