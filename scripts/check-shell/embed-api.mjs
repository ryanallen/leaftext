// The surface a product calls to mount an embedded document.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { checkSettled, root } from './shared.mjs';

export function run() {
  const reactSourceText = readFileSync(join(root, 'web/embed/react.js'), 'utf8');

  if (!reactSourceText.includes("import * as React from 'react';")) {
    throw new Error('the React layer no longer takes React from its caller');
  }
  const previewLoader = readFileSync(join(root, 'web/preview/leaftext.js'), 'utf8');
  if (!previewLoader.includes("from '../module.js'")) throw new Error('the render-only page does not share the browser module boundary');
  if (/WebAssembly\.instantiate|leaf_alloc/.test(previewLoader)) throw new Error('the render-only page still carries its own byte boundary');

  checkSettled('the embed API mounts a frame and exposes commands, events and document state', async () => {
    const hostSource = readFileSync(join(root, 'web/embed/host.js'), 'utf8');
    const hostContext = vm.createContext({ console, setTimeout, clearTimeout, TextEncoder, window: {} });
    new vm.Script(hostSource.replace(/^export /gm, '') + '\nglobalThis.hostExports = { ANSWERED, COMMANDS, startLeaftextEmbed };').runInContext(hostContext);

    const apiSource = readFileSync(join(root, 'web/embed/api.js'), 'utf8')
      .replace(/^import .*$/gm, '')
      .replace(/^export /gm, '') +
      '\nglobalThis.apiExports = { commands, createLeaftext, LeaftextReader, LeaftextEditor };';
    const context = vm.createContext({
      console,
      setTimeout,
      clearTimeout,
      TextEncoder,
      loadLeaftextModule: async () => null,
      ...hostContext.hostExports,
    });
    new vm.Script(apiSource, { filename: 'embed-api.js' }).runInContext(context);

    let text = '# Notes\n\nA paragraph.\n';
    let saved = text;
    let open = true;
    const state = () => ({ path: 'notes.md', dirty: text !== saved, canUndo: text !== saved, canRedo: false, utf16Len: text.length, spelling: { encoding: 'utf8', mark: false } });
    const module = {
      page: () => '<html><head><link rel="stylesheet" href="assets/app.css"></head><body><script src="assets/app.js" crossorigin="anonymous" defer></script></body></html>',
      script: () => '',
      styles: () => '',
      embedBoot: () => '',
      formats: () => ['md'],
      setGlossary() {},
      glossaryScript: () => '',
      buffer: {
        open: () => 1,
        close: () => {
          open = false;
        },
        source: () => (open ? text : null),
        encoded: () => new TextEncoder().encode(text),
        state,
        codeView: () => ({ text, language: 'markdown', displayName: 'Markdown', dirty: text !== saved }),
        documentScript: () => '',
        saveScript: (handle, ok) => {
          if (ok) saved = text;
          return '';
        },
        edit: (handle, edit) => {
          if (edit.edit === 'block') text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
          return { ...state(), changed: true };
        },
      },
    };
    const page = { Function: Function, __leafPending: [], __leafRun: (script) => new Function(script)(), leafSetState() {}, print() {} };
    const frame = {
      contentWindow: page,
      contentDocument: {
        open() {},
        write(value) {
          frame.html = value;
        },
        close() {},
      },
      remove() {
        this.removed = true;
      },
    };
    const target = {
      ownerDocument: { createElement: () => frame },
      replaceChildren(child) {
        this.child = child;
      },
    };
    const writes = [];
    const leaftext = await context.apiExports.createLeaftext({ module });
    const document_ = await leaftext.editor(target, { source: text, path: 'notes.md', save: (document) => writes.push(document) });
    const events = [];
    const unsubscribe = document_.subscribe((event) => events.push(event));
    document_.command('editBlock', { start: 10, end: 22, text: 'Changed.' });
    await document_.save();
    if (target.child !== frame || !frame.html.includes('window.__leafHostAnswers')) throw new Error('the API did not mount the Leaftext page');
    if (document_.state.path !== 'notes.md' || document_.commands.source !== 'enterCodeView') throw new Error('the mounted document exposes no state or command surface');
    if (!events.some((event) => event.kind === 'document')) throw new Error('a subscribed caller did not hear the edit');
    if (writes.length !== 1 || !writes[0].text.includes('Changed.')) throw new Error('one save did not hand the caller the edited document');
    const heard = events.length;
    unsubscribe();
    document_.command('undo');
    document_.destroy();
    if (!frame.removed || open) throw new Error('destroy left the frame or buffer standing');
    if (events.length !== heard) throw new Error('an unsubscribed listener still heard an event');
  });

  checkSettled('the React layer mounts through the caller React and unsubscribes when it goes', async () => {
    const effects = [];
    const cleanups = [];
    const contextRecord = { value: null };
    const React = {
      createContext() {
        return {
          Provider({ value, children }) {
            contextRecord.value = value;
            return children;
          },
        };
      },
      createElement(type, props, ...children) {
        if (typeof type === 'function') return type({ ...props, children: children.length > 1 ? children : children[0] });
        if (props && props.ref) props.ref.current = { nodeName: String(type).toUpperCase() };
        return { type, props, children };
      },
      useState(initial) {
        let value = initial;
        return [value, (next) => {
          value = typeof next === 'function' ? next(value) : next;
        }];
      },
      useEffect(effect) {
        effects.push(effect);
      },
      useCallback(callback) {
        return callback;
      },
      useMemo(make) {
        return make();
      },
      useContext() {
        return contextRecord.value;
      },
      useRef(value) {
        return { current: value };
      },
    };
    const reactSource = reactSourceText
      .replace(/^import .*$/gm, '')
      .replace(/^export /gm, '') +
      '\nglobalThis.reactExports = { LeaftextProvider, LeaftextReader, LeaftextEditor, useLeaftext };';
    const context = vm.createContext({ console, React, createLeaftext: async () => null });
    new vm.Script(reactSource, { filename: 'embed-react.js' }).runInContext(context);

    let readers = 0;
    let editors = 0;
    let unsubscribed = 0;
    let destroyed = 0;
    const document_ = {
      state: { path: 'notes.md' },
      subscribe: () => () => {
        unsubscribed += 1;
      },
      destroy: () => {
        destroyed += 1;
      },
    };
    const leaftext = {
      reader: async () => {
        readers += 1;
        return document_;
      },
      editor: async () => {
        editors += 1;
        return document_;
      },
    };
    context.reactExports.LeaftextProvider({ leaftext, children: null });
    context.reactExports.LeaftextReader({ source: '# Notes' });
    context.reactExports.LeaftextEditor({ source: '# Notes' });
    for (const effect of effects.splice(0)) {
      const cleanup = effect();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    }
    await Promise.resolve();
    if (readers !== 1 || editors !== 1) throw new Error(`the React layer mounted ${readers} readers and ${editors} editors`);
    const value = context.reactExports.useLeaftext();
    if (value.leaftext !== leaftext) throw new Error('the hook did not read the caller-supplied runtime');
    for (const cleanup of cleanups.reverse()) cleanup();
    if (unsubscribed !== 2 || destroyed !== 2) throw new Error(`unmount unsubscribed ${unsubscribed} times and destroyed ${destroyed} times`);
  });

  checkSettled('a product round-trips the complete Markdown fixture through the embed', async () => {
    const rust = readFileSync(join(root, 'src/tests/web_core.rs'), 'utf8');
    const literal = rust.match(/MARKDOWN_FIXTURE: &str = ("(?:\\.|[^"\\])*");/);
    if (!literal) throw new Error('MARKDOWN_FIXTURE is not a readable string literal');
    let text = JSON.parse(literal[1]);
    let saved = null;
    let renders = 0;
    const state = () => ({ path: 'notes.md', dirty: true, canUndo: true, canRedo: false, utf16Len: text.length, spelling: { encoding: 'utf8', mark: false } });
    const module = {
      setGlossary() {},
      glossaryScript: () => '',
      buffer: {
        open: () => 1,
        close() {},
        source: () => text,
        encoded: () => new TextEncoder().encode(text),
        state,
        documentScript: () => {
          renders += 1;
          return '';
        },
        saveScript: () => '',
        edit(handle, edit) {
          text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
          return { ...state(), changed: true };
        },
      },
    };
    const page = { __leafPending: [], __leafRun() {}, print() {} };
    const hostSource = readFileSync(join(root, 'web/embed/host.js'), 'utf8');
    const context = vm.createContext({ console, page, module, TextEncoder, window: page });
    new vm.Script(hostSource.replace(/^export /gm, '') + '\nglobalThis.start = startLeaftextEmbed;').runInContext(context);
    const host = context.start({ module, page, source: text, path: 'notes.md', save: (document) => {
      saved = document.text;
    } });
    const start = text.indexOf('A paragraph');
    const end = text.indexOf('\n', start);
    host.command('editBlock', { start, end, text: 'An edited paragraph with a [link](https://example.com) and `code`.' });
    await host.save();
    for (const kept of ['title: Notes', '| a | b |', '- [x] a task', '> [!NOTE]', '```rust', '[^1]: The note.']) {
      if (!saved.includes(kept)) throw new Error(`the round trip lost ${JSON.stringify(kept)}`);
    }
    if (!saved.includes('An edited paragraph')) throw new Error('the edited block did not reach the saved document');
    if (renders !== 2) throw new Error(`the initial document and its edit rendered ${renders} times`);
  });
}
