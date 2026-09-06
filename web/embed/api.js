import { loadLeaftextModule } from '../module.js';
import { ANSWERED, COMMANDS, startLeaftextEmbed } from './host.js';

const LOAD_DEADLINE_MS = 10000;

export const commands = Object.freeze({
  save: 'saveDocument',
  undo: 'undoEdit',
  redo: 'redoEdit',
  source: 'enterCodeView',
  reading: 'exitCodeView',
  editBlock: 'editBlock',
  editBlocks: 'editBlocks',
  toggleTask: 'toggleTask',
  setField: 'setField',
  setListField: 'setListField',
  renameField: 'renameField',
  moveBlock: 'moveBlock',
  spliceSource: 'spliceSource',
  updateSource: 'updateSource',
});

function scriptText(source) {
  return String(source || '').replace(/<\/script/gi, '<\\/script');
}

function embeddedPage(module, editable, assetBase) {
  const answered = Object.entries(COMMANDS)
    .filter(([, answer]) => answer[0] === ANSWERED)
    .map(([name]) => name);
  const boot = `window.__leafPending = [];\nwindow.ipc = { postMessage: message => window.__leafPending.push(message) };\n${module.embedBoot(editable)}\nwindow.__leafHostAnswers = command => ${JSON.stringify(answered)}.includes(command);`;
  let html = module.page();
  html = html.replace(
    /<script src="assets\/app\.js" crossorigin="anonymous" defer><\/script>/,
    `<script>${scriptText(boot)}</script><script src="assets/app.js" crossorigin="anonymous" defer></script>`
  );
  return html.replaceAll('assets/', assetBase);
}

async function waitForFrontEnd(frame) {
  const until = Date.now() + LOAD_DEADLINE_MS;
  while (Date.now() < until) {
    if (typeof frame.contentWindow?.leafSetState === 'function') return;
    await new Promise((done) => setTimeout(done, 10));
  }
  const reported = (frame.contentWindow?.__leafPending || []).find((message) => {
    try {
      return JSON.parse(message).command === 'logError';
    } catch {
      return false;
    }
  });
  if (reported) throw new Error(JSON.parse(reported).message);
  throw new Error('the Leaftext front end did not load');
}

/** Load Leaftext once, then mount any number of reader or editor frames over it. */
export async function createLeaftext({ module = null, moduleUrl = 'assets/leaftext-embed.wasm', assetBase = 'assets/' } = {}) {
  const loaded = module || (await loadLeaftextModule(moduleUrl));
  if (!loaded.buffer) throw new Error('the Leaftext module has no document buffer');
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;

  const mount = async (target, { source, path = 'document.md', editable = false, save = null, glossary = '', onEvent = null } = {}) => {
    if (!target || typeof target.replaceChildren !== 'function') throw new Error('Leaftext needs an element to mount into');
    const owner = target.ownerDocument || document;
    const frame = owner.createElement('iframe');
    frame.className = 'leaftext-frame';
    frame.title = path;
    target.replaceChildren(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(embeddedPage(loaded, editable, base));
    frame.contentDocument.close();
    await waitForFrontEnd(frame);

    const listeners = new Set();
    if (typeof onEvent === 'function') listeners.add(onEvent);
    const report = (event) => {
      for (const listener of listeners) listener(event);
    };
    const host = startLeaftextEmbed({
      module: loaded,
      page: frame.contentWindow,
      source,
      path,
      save,
      glossary,
      onEvent: report,
    });
    const controller = {
      frame,
      commands,
      get state() {
        return host.state();
      },
      source: host.source,
      bytes: host.bytes,
      save: host.save,
      refused: host.refused,
      command: (command, detail = {}) => host.command(commands[command] || command, detail),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      destroy() {
        listeners.clear();
        host.close();
        frame.remove();
      },
    };
    report({ kind: 'ready', state: controller.state });
    return controller;
  };

  return {
    formats: loaded.formats(),
    mount,
    reader: (target, options) => mount(target, { ...options, editable: false }),
    editor: (target, options) => mount(target, { ...options, editable: true }),
  };
}

export async function LeaftextReader({ target, ...options }) {
  const leaftext = await createLeaftext(options);
  return leaftext.reader(target, options);
}

export async function LeaftextEditor({ target, ...options }) {
  const leaftext = await createLeaftext(options);
  return leaftext.editor(target, options);
}
