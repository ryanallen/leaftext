// The page reporting its own errors, and the source view that will not open saying so.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  check,
  checkSettled,
  names,
  record,
  root,
  runShell,
  settle,
  settled,
  source,
} from './shared.mjs';

export function run() {
  const booted = record.booted;
  if (!booted) return;

  // ---- 6. the page reports its own errors -------------------------------------

  // journal.js leads the list so that a fragment throwing as it loads is reported instead of vanishing. That claim is about load order, so it is checked by loading things in order — journal.js, then a fragment that throws — rather than by reading the list and trusting it.

  /** journal.js alone, plus whatever tail the test wants, against a recording ipc. */
  function runJournal(tail = '') {
    const sent = [];
    const errors = [];
    const sandbox = {
      console: { log() {}, warn() {}, debug() {}, error: (...args) => errors.push(args) },
      ipc: { postMessage: (text) => sent.push(JSON.parse(text)) },
      addEventListener(name, handler) {
        this.listeners[name] = handler;
      },
      listeners: {},
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    const source = readFileSync(join(root, 'src/assets/shell/journal.js'), 'utf8') + tail;
    let threw = null;
    try {
      new vm.Script(source, { filename: 'journal-check.js' }).runInContext(context);
    } catch (error) {
      threw = error;
    }
    return { sandbox, sent, errors, threw };
  }

  check('journal.js leads the list, so a later fragment can throw into it', () => {
    const first = names[0];
    if (first !== 'shell/journal.js') {
      throw new Error(`journal.js must be first in APP_SHELL_SCRIPT_PARTS, found ${first}`);
    }

    // A fragment appended after it throws as it loads. Node has no window.onerror dispatch, so the throw comes back here — what matters is that the handler was already installed when it happened, and that it turns the throw into a report.
    const { sandbox, sent, threw } = runJournal('\nthrow new Error("a fragment broke");\n');
    if (!threw) throw new Error('the appended fragment was supposed to throw');
    if (typeof sandbox.onerror !== 'function') {
      throw new Error('window.onerror was not installed before the fragment ran');
    }

    sandbox.onerror(threw.message, 'app.js', 12, 3, threw);
    if (sent.length !== 1) throw new Error(`expected one message, got ${sent.length}`);
    const [message] = sent;
    if (message.command !== 'logError') throw new Error(`sent ${message.command}, not logError`);
    if (!message.message.includes('a fragment broke')) {
      throw new Error(`the report lost the message: ${message.message}`);
    }
    if (!message.message.includes('app.js:12:3')) {
      throw new Error(`the report lost the place: ${message.message}`);
    }
  });

  check('a repeated error is counted, not repeated', () => {
    // Two of the eight console.error calls in the shell sit inside per-diagram loops. Sending every one would fill the log file in seconds.
    const { sandbox, sent, errors } = runJournal();
    for (let i = 0; i < 100; i += 1) sandbox.console.error('the same thing went wrong');

    // Every call still reaches the real console — the web view's own log is not quietened, only the file.
    if (errors.length !== 100) throw new Error(`the console lost calls: ${errors.length} of 100`);
    // 1, 2, 4, 8, 16, 32, 64 — seven, and the last one says how far it got.
    if (sent.length !== 7) throw new Error(`expected 7 messages for 100 errors, got ${sent.length}`);
    if (sent[sent.length - 1].count !== 64) {
      throw new Error(`the count did not ride along: ${sent[sent.length - 1].count}`);
    }

    // A different message is its own count, not folded into the first.
    sandbox.console.error('something else');
    if (sent[sent.length - 1].count !== 1) throw new Error('two messages shared one count');
  });

  check('an unhandled rejection reaches the same place', () => {
    const { sandbox, sent } = runJournal();
    const onRejection = sandbox.listeners.unhandledrejection;
    if (typeof onRejection !== 'function') throw new Error('nothing listens for a rejection');
    onRejection({ reason: new Error('a promise gave up') });
    if (sent.length !== 1 || !sent[0].message.includes('a promise gave up')) {
      throw new Error(`the rejection did not arrive: ${JSON.stringify(sent)}`);
    }
  });

  // The request half of the CORS pair: a script fetched without anonymous mode has every throw inside it masked as `Script error.` with no place, whatever the response allows. The response half — the asset handler's allow-origin header — is held by src/tests/theme_registry.rs, and the page's own tag by src/tests/app_shell_chrome_boot.rs.
  check('every constructed script tag asks for its errors unmasked', () => {
    const constructors = [...source.matchAll(/document\.createElement\('script'\)/g)];
    if (constructors.length < 3) {
      throw new Error(`expected the Mermaid, KaTeX, and shared lazy-script constructors, found ${constructors.length}`);
    }
    for (const match of constructors) {
      const appended = source.indexOf('appendChild', match.index);
      const constructor = source.slice(match.index, appended === -1 ? match.index + 400 : appended);
      if (!constructor.includes(".crossOrigin = 'anonymous'")) {
        throw new Error(`a constructed script tag loads without anonymous mode: ${constructor.slice(0, 200)}`);
      }
    }
  });

  // ---- 6a. a source view that will not open says so and gives the document back ----
  //
  // Both ways into the source view can give up, and each has to draw something: the editor's own load fails after the reader has already been emptied into its container, and the staged payload fails before that. Drawing nothing leaves the reader a blank page the app is calling the source view, or a press that did nothing. Driven rather than read, because what is being held is a growl on the surface and a command on the wire.

  /** A booted page with one document open, its ipc recording, and the reader's own scroll position remembered the way the toggle remembers it. */
  function bootEnteringSource(extras = {}) {
    const context = runShell(source, extras);
    const posted = [];
    context.ipc = { postMessage: (text) => posted.push(JSON.parse(text)) };
    vm.runInContext("currentState = { recent: [], tabs: [{ path: 'notes.md' }], active: 0, document: {} };", context);
    vm.runInContext("viewHandoff = { path: 'notes.md', readerScrollTop: 940, codeScrollTop: null, readerLanded: 940, codeLanded: null, restoreExact: false };", context);
    const surface = context.document.getElementById('appSurface');
    return {
      context,
      posted,
      growls: () => surface.children.filter((child) => String(child.className || '').includes('app-toast')),
    };
  }

  /** Everything the two paths owe a reader, read off the page and the wire. */
  function saidAndWentBack(page, what) {
    const growls = page.growls();
    if (growls.length !== 1) throw new Error(`${what}: expected one growl, got ${growls.length}`);
    const said = String(growls[0].textContent);
    if (!said.includes('source view could not be opened')) throw new Error(`${what}: the growl said "${said}"`);
    if (!growls[0].className.includes('is-error')) throw new Error(`${what}: a failure drew the quiet growl`);
    if (!page.posted.some((one) => one.command === 'exitCodeView')) {
      throw new Error(`${what}: the tab was left marked as being in source view — sent ${JSON.stringify(page.posted)}`);
    }
    // The reader was part way down a page, so the reading render owes them that pixel rather than the top the host's reset intent asks for.
    if (vm.runInContext('viewHandoff.restoreExact', page.context) !== true) {
      throw new Error(`${what}: going back was not armed to land where the reader was`);
    }
  }

  checkSettled('the source editor refusing to load says so and gives the document back', async () => {
    const page = bootEnteringSource();
    // The vendored bundle is fetched as a script tag the stand-in page never resolves, so the refusal is put where a missing or broken asset puts it.
    vm.runInContext("loadScriptOnce = () => Promise.reject(new Error('the bundle would not load'));", page.context);
    vm.runInContext("codeViewActive = true; renderCodeView({ text: 'a line of source', language: 'markdown' });", page.context);
    await new Promise((resolve) => setImmediate(resolve));
    page.context.__frames.drain();
    await new Promise((resolve) => setImmediate(resolve));
    saidAndWentBack(page, 'the editor giving up');
    // The state this check is about: the reader has been emptied into the editor's container and there is nothing in it. If that stops being true the check is passing on a different failure and says so.
    if (!vm.runInContext("app.className.includes('code-view-monaco-shell') && app.textContent === ''", page.context)) {
      throw new Error('the editor path no longer leaves the reader emptied, so this check is holding something else');
    }
  });

  checkSettled('the staged source payload refusing to arrive says so too', async () => {
    const page = bootEnteringSource({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    page.context.window.leafLoadCodeView('leaf-source://1');
    await new Promise((resolve) => setImmediate(resolve));
    page.context.__frames.drain();
    await new Promise((resolve) => setImmediate(resolve));
    saidAndWentBack(page, 'the payload giving up');
    // This path fails before the reader is replaced, so what it must not do is disturb the document that is still on screen.
    if (vm.runInContext('codeViewActive', page.context) !== false) {
      throw new Error('the page thinks it entered the source view on a payload that never arrived');
    }
  });

  checkSettled('a refused source editor is not the answer to the next press', async () => {
    const page = bootEnteringSource();
    let attempts = 0;
    vm.runInContext("loadScriptOnce = () => { __attempt(); return Promise.reject(new Error('the bundle would not load')); };", page.context);
    page.context.__attempt = () => {
      attempts += 1;
    };
    const settle = () => vm.runInContext("loadMonacoOnce().then(() => 'loaded', (error) => 'refused: ' + error.message)", page.context);
    const first = await settle();
    if (first !== 'refused: the bundle would not load') throw new Error(`the first press settled as ${first}`);
    // The whole point: the second press builds its own attempt rather than being handed the one that already failed.
    if (vm.runInContext('monacoLoadPromise', page.context) !== null) {
      throw new Error('the refusal is still held, so every later press gets it back');
    }
    const second = await settle();
    if (second !== 'refused: the bundle would not load') throw new Error(`the second press settled as ${second}`);
    if (attempts !== 2) throw new Error(`two presses made ${attempts} attempts at the bundle`);
  });
}
